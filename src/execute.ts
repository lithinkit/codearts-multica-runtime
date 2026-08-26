import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodeArtsClient, Session } from './client.js'
import { parseSSE, type SSEEvent } from './sse.js'
import {
  encodeFrame,
  parseInboundCommand,
  PROTOCOL_VERSION,
  type ExecuteCommand,
  type OutboundFrame,
} from './protocol.js'
import { toOpenCodeFrame, opencodeSetPrompt } from './opencode-format.js'

const PLUGIN_VERSION = '1.0.0'

const useOpenCode = process.argv[2] === 'run'

// Persist opencode→kernel session mapping across process restarts
const SESSION_FILE = join(tmpdir(), 'codearts-multica-sessions.json')
let sessionStore: Map<string, string>
try {
  if (existsSync(SESSION_FILE)) {
    sessionStore = new Map(JSON.parse(readFileSync(SESSION_FILE, 'utf8')))
  } else {
    sessionStore = new Map()
  }
} catch { sessionStore = new Map() }

function saveSessionStore(): void {
  try {
    mkdirSync(tmpdir(), { recursive: true })
    writeFileSync(SESSION_FILE, JSON.stringify([...sessionStore]))
  } catch { /* ignore */ }
}

function extractCwd(): string {
  const args = process.argv.slice(2)
  const dirIdx = args.indexOf('--dir')
  if (dirIdx >= 0 && dirIdx + 1 < args.length) return args[dirIdx + 1]
  return process.cwd()
}

function extractSessionId(): string | undefined {
  const args = process.argv.slice(2)
  const sIdx = args.indexOf('--session')
  if (sIdx >= 0 && sIdx + 1 < args.length) return args[sIdx + 1]
  return undefined
}

function writeFrame(frame: OutboundFrame): void {
  if (useOpenCode) {
    const oc = toOpenCodeFrame(frame)
    if (oc) process.stdout.write(oc)
  } else {
    process.stdout.write(encodeFrame(frame))
  }
}

function writeDiagnostic(message: string): void {
  process.stderr.write(`codearts-multica-runtime: ${message}\n`)
}

interface ActiveRun {
  command: ExecuteCommand
  cancelRequested: boolean
  sessionId?: string
  lastText: string
  toolNames: Map<string, string>
}

interface KernelPart {
  id?: string
  type?: string
  text?: string
  tool?: string
  callID?: string
  reason?: string
  tokens?: {
    total?: number
    input?: number
    output?: number
    reasoning?: number
    cache?: { write?: number; read?: number }
  }
  state?: {
    status?: string
    input?: Record<string, unknown>
    output?: string
  }
}

interface KernelInfo {
  id?: string
  role?: string
  finish?: string
  tokens?: {
    total?: number
    input?: number
    output?: number
    reasoning?: number
    cache?: { write?: number; read?: number }
  }
  modelID?: string
  providerID?: string
}

async function handleExecute(client: CodeArtsClient, active: ActiveRun): Promise<number> {
  let session: Session | undefined
  let sseResponse: Response | undefined

  try {
    if (!isAbsolute(active.command.cwd)) throw new Error('cwd must be an absolute path')

    // Reuse stored session for resumption to avoid rate limits (same context window)
    const storedSid = active.command.resume_session_id
    if (storedSid && sessionStore.has(storedSid)) {
      session = { id: sessionStore.get(storedSid)!, status: undefined }
    } else {
      session = await client.createSession('C:/codeartsproject')
      if (storedSid) { sessionStore.set(storedSid, session.id); saveSessionStore() }
      if (storedSid) { sessionStore.set(storedSid, session.id); saveSessionStore() }
    }
    active.sessionId = session.id

    writeFrame({
      v: PROTOCOL_VERSION,
      type: 'session',
      request_id: active.command.request_id,
      session_id: session.id,
      resumed: false,
    })

    sseResponse = await client.connectSSE()

    const sseIterator = parseSSE(sseResponse)

    const promptPromise = client.sendPrompt(
      session.id,
      active.command.prompt,
      { id: 'deepseek-v4-pro', provider_id: 'openai-9716a4a24ed8902d' },
    )

    let receivedStop = false

    const processSse = (async () => {
      for await (const event of sseIterator) {
        if (active.cancelRequested && !receivedStop) return

        switch (event.type) {
          case 'message.part.updated': {
            const part = (event.properties.part ?? event.properties) as KernelPart
            const partType = part.type
            if (partType === 'reasoning' && part.text) {
              writeFrame({
                v: PROTOCOL_VERSION,
                type: 'thinking',
                request_id: active.command.request_id,
                content: part.text,
              })
            } else if (partType === 'text' && part.text) {
              active.lastText += part.text
              writeFrame({
                v: PROTOCOL_VERSION,
                type: 'text',
                request_id: active.command.request_id,
                content: part.text,
              })
            } else if (partType === 'tool') {
              const toolName = part.tool ?? 'unknown'
              const callId = part.callID ?? part.id ?? 'unknown'
              const args = part.state?.input ? JSON.stringify(part.state.input) : '{}'

              active.toolNames.set(callId, toolName)

              if (part.state?.status === 'pending' || part.state?.status === 'running') {
                writeFrame({
                  v: PROTOCOL_VERSION,
                  type: 'tool_call',
                  request_id: active.command.request_id,
                  call_id: callId,
                  name: toolName,
                  arguments: args,
                })
              } else if (part.state?.status === 'completed') {
                writeFrame({
                  v: PROTOCOL_VERSION,
                  type: 'tool_call',
                  request_id: active.command.request_id,
                  call_id: callId,
                  name: toolName,
                  arguments: args,
                })
                if (part.state.output) {
                  writeFrame({
                    v: PROTOCOL_VERSION,
                    type: 'tool_result',
                    request_id: active.command.request_id,
                    call_id: callId,
                    name: toolName,
                    output: part.state.output,
                    is_error: false,
                  })
                }
              }
            } else if (partType === 'step-finish' && part.tokens) {
              writeFrame({
                v: PROTOCOL_VERSION,
                type: 'usage',
                request_id: active.command.request_id,
                provider: active.command.model?.provider ?? 'unknown',
                model: active.command.model?.id ?? 'unknown',
                input_tokens: part.tokens.input ?? 0,
                output_tokens: part.tokens.output ?? 0,
                ...(part.tokens.reasoning !== undefined ? { reasoning_tokens: part.tokens.reasoning } : {}),
                ...(part.tokens.cache?.read !== undefined ? { cache_read_tokens: part.tokens.cache.read } : {}),
                ...(part.tokens.cache?.write !== undefined ? { cache_write_tokens: part.tokens.cache.write } : {}),
              })
            }
            break
          }

          case 'message.part.delta': {
            const dp = event.properties.part as { type?: string; text?: string } | undefined
            if (dp?.type === 'text' && dp.text) {
              active.lastText += dp.text
              writeFrame({
                v: PROTOCOL_VERSION,
                type: 'text',
                request_id: active.command.request_id,
                content: dp.text,
              })
            }
            break
          }

          case 'message.updated': {
            const info = (event.properties.info ?? event.properties) as KernelInfo
            if (info.tokens) {
              writeFrame({
                v: PROTOCOL_VERSION,
                type: 'usage',
                request_id: active.command.request_id,
                provider: info.providerID ?? active.command.model?.provider ?? 'unknown',
                model: info.modelID ?? active.command.model?.id ?? 'unknown',
                input_tokens: info.tokens.input ?? 0,
                output_tokens: info.tokens.output ?? 0,
                ...(info.tokens.reasoning !== undefined ? { reasoning_tokens: info.tokens.reasoning } : {}),
                ...(info.tokens.cache?.read !== undefined ? { cache_read_tokens: info.tokens.cache.read } : {}),
                ...(info.tokens.cache?.write !== undefined ? { cache_write_tokens: info.tokens.cache.write } : {}),
              })
            }
            if (info.role === 'assistant' && info.finish) {
              if (info.finish === 'stop' || info.finish === 'error' || info.finish === 'max-tokens') {
                receivedStop = true
                const status = info.finish === 'stop' ? 'completed' as const :
                               info.finish === 'error' ? 'failed' as const : 'completed' as const
                writeFrame({
                  v: PROTOCOL_VERSION,
                  type: 'result',
                  request_id: active.command.request_id,
                  session_id: active.sessionId,
                  status: active.cancelRequested ? 'cancelled' : status,
                  output: active.lastText,
                  stop_reason: info.finish,
                  resume_rejected: false,
                  ...(status === 'failed' ? { error: { code: 'CODEARTS_ERROR', message: 'kernel reported error finish' } } : {}),
                })
                return
              }
            }
            break
          }

          case 'server.heartbeat':
          case 'session.created':
          case 'server.connected':
            break

          case 'session.error': {
            const err = (event.properties.error ?? event.properties) as { name?: string; data?: { message?: string } }
            const msg = err.data?.message ?? err.name ?? 'unknown'
            // Ignore non-fatal warnings (cooldown, rate monitor, etc.)
            if (msg.includes('访问量') || msg.includes('重试')) {
              writeDiagnostic(`non-fatal: ${msg}`)
              break
            }
            writeDiagnostic(`session error: ${msg}`)
            if (!receivedStop) {
              receivedStop = true
              writeFrame({
                v: PROTOCOL_VERSION,
                type: 'result',
                request_id: active.command.request_id,
                session_id: active.sessionId,
                status: 'failed',
                output: active.lastText,
                stop_reason: 'session-error',
                resume_rejected: false,
                error: { code: 'CODEARTS_SESSION_ERROR', message: msg },
              })
              return
            }
            break
          }
        }
      }

      if (!receivedStop && !active.cancelRequested) {
        writeFrame({
          v: PROTOCOL_VERSION,
          type: 'result',
          request_id: active.command.request_id,
          session_id: active.sessionId,
          status: 'failed',
          output: active.lastText,
          stop_reason: 'sse-disconnected',
          resume_rejected: false,
          error: { code: 'SSE_DISCONNECTED', message: 'SSE connection closed unexpectedly' },
        })
      }
    })()

    await promptPromise
    await processSse

    return active.cancelRequested ? 0 : (receivedStop ? 0 : 1)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    writeDiagnostic(msg)
    if (active.command.request_id) {
      writeFrame({
        v: PROTOCOL_VERSION,
        type: 'result',
        request_id: active.command.request_id,
        status: active.cancelRequested ? 'cancelled' : 'failed',
        output: active.lastText,
        resume_rejected: false,
        error: { code: 'CODEARTS_RUNTIME_ERROR', message: msg },
      })
    }
    return active.cancelRequested ? 0 : 1
  } finally {
    if (session) { client.deleteSession(session.id).catch(() => {}) }
    try { sseResponse?.body?.cancel() } catch { /* ignore */ }
  }
}

export async function handleStdio(client: CodeArtsClient): Promise<number> {
  writeFrame({
    v: PROTOCOL_VERSION,
    type: 'ready',
    runtime: 'codearts',
    plugin_version: PLUGIN_VERSION,
    capabilities: {
      resume: false,
      cancel: false,
      models: true,
      thinking: true,
      usage: true,
      tools: true,
      mcp: [],
    },
  })

  const input = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity })

  const activeRef: { current?: ActiveRun; finished: boolean } = { finished: false }
  let resolveExecute: ((command: ExecuteCommand) => void) | undefined
  let rejectExecute: ((error: Error) => void) | undefined

  const firstExecute = new Promise<ExecuteCommand>((resolve, reject) => {
    resolveExecute = resolve
    rejectExecute = reject
  })

  const stdinLines: string[] = []
  let captureDone = false

  input.on('line', (line) => {
    if (captureDone) return

    try {
      const command = parseInboundCommand(line)
      captureDone = true
      if (idleTimer) clearTimeout(idleTimer)
      if (command.type === 'execute') {
        if (activeRef.current !== undefined || resolveExecute === undefined) return
        const active: ActiveRun = { command, cancelRequested: false, lastText: '', toolNames: new Map() }
        activeRef.current = active
        const rc = resolveExecute; resolveExecute = undefined; rejectExecute = undefined; rc(command)
        return
      }
      if (command.type === 'cancel') {
        const active = activeRef.current
        if (active === undefined || command.request_id !== active.command.request_id || activeRef.finished) return
        active.cancelRequested = true
        return
      }
    } catch {
      // Not JSONL — collect as raw text (opencode protocol)
    }

    stdinLines.push(line)
    scheduleCapture()
  })

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleCapture = () => {
    if (captureDone || resolveExecute === undefined) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (captureDone) return
      captureDone = true
      // Extract user message: lines after "User message:" until next blank line or ## section
      let prompt = ''
      let captureMsg = false
      for (const line of stdinLines) {
        if (line.startsWith('User message:')) { captureMsg = true; continue }
        if (captureMsg) {
          if (line === '' || line.startsWith('## ') || line.startsWith('To include')) break
          prompt += line + '\n'
        }
      }
      prompt = prompt.trim() || stdinLines.filter(l => l.trim() !== '').pop() || ''
      opencodeSetPrompt(prompt)
      const cwd = extractCwd()
      const command: ExecuteCommand = {
        v: PROTOCOL_VERSION,
        type: 'execute',
        request_id: `req_${randomUUID().slice(0, 8)}`,
        cwd,
        prompt: prompt || stdinLines[0] || '',
        mcp_servers: [],
        ...(extractSessionId() ? { resume_session_id: extractSessionId() } : {}),
      }
      writeDiagnostic(`[EXEC] cwd=${cwd} prompt_len=${prompt.length}`)
      const active: ActiveRun = { command, cancelRequested: false, lastText: '', toolNames: new Map() }
      activeRef.current = active
      if (resolveExecute) {
        const rc = resolveExecute; resolveExecute = undefined; rejectExecute = undefined; rc(command)
      }
    }, 200)
  }

  input.on('close', scheduleCapture)

  try {
    await firstExecute
  } catch (error: unknown) {
    writeDiagnostic(error instanceof Error ? error.message : String(error))
    input.close()
    return 1
  }

  const active = activeRef.current
  if (active === undefined) return 1

  const code = await handleExecute(client, active)
  activeRef.finished = true
  input.close()
  return code
}