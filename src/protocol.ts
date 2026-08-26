export const PROTOCOL_VERSION = 1
export const MAX_COMMAND_BYTES = 8 * 1024 * 1024

interface ModelSelectionInput {
  provider: string
  id: string
  reasoning_effort?: string
}

interface McpServerBase {
  name: string
  tool_call_timeout_ms?: number
}

interface StdioMcpServer extends McpServerBase {
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
}

interface StreamableHttpMcpServer extends McpServerBase {
  transport: 'streamable-http'
  url: string
  headers: Record<string, string>
}

type McpServerInput = StdioMcpServer | StreamableHttpMcpServer

export interface ExecuteCommand {
  v: typeof PROTOCOL_VERSION
  type: 'execute'
  request_id: string
  cwd: string
  prompt: string
  resume_session_id?: string
  model?: ModelSelectionInput
  reasoning_effort?: string
  mcp_servers: McpServerInput[]
}

interface CancelCommand {
  v: typeof PROTOCOL_VERSION
  type: 'cancel'
  request_id: string
}

type InboundCommand = ExecuteCommand | CancelCommand

export interface RuntimeModelFrame {
  id: string
  label: string
  provider: string
  default?: boolean
  context_window?: number
  thinking?: {
    supported_levels: Array<{ value: string; label: string; description?: string }>
    default_level?: string
  }
}

export type OutboundFrame =
  | {
      v: typeof PROTOCOL_VERSION
      type: 'ready'
      runtime: 'codearts'
      plugin_version: string
      capabilities: {
        resume: false
        cancel: boolean
        models: boolean
        thinking: boolean
        usage: boolean
        tools: boolean
        mcp: []
      }
    }
  | { v: typeof PROTOCOL_VERSION; type: 'probe'; runtime: 'codearts'; plugin_version: string; protocol_version: number }
  | { v: typeof PROTOCOL_VERSION; type: 'models'; models: RuntimeModelFrame[] }
  | { v: typeof PROTOCOL_VERSION; type: 'session'; request_id: string; session_id: string; resumed: boolean }
  | { v: typeof PROTOCOL_VERSION; type: 'text'; request_id: string; content: string }
  | { v: typeof PROTOCOL_VERSION; type: 'thinking'; request_id: string; content: string }
  | { v: typeof PROTOCOL_VERSION; type: 'tool_call'; request_id: string; call_id: string; name: string; arguments: string }
  | {
      v: typeof PROTOCOL_VERSION
      type: 'tool_result'
      request_id: string
      call_id: string
      name: string
      output: string
      is_error: boolean
      truncated?: boolean
    }
  | {
      v: typeof PROTOCOL_VERSION
      type: 'usage'
      request_id: string
      provider: string
      model: string
      input_tokens: number
      output_tokens: number
      cache_read_tokens?: number
      cache_write_tokens?: number
      reasoning_tokens?: number
    }
  | {
      v: typeof PROTOCOL_VERSION
      type: 'result'
      request_id: string
      status: 'completed' | 'failed' | 'aborted' | 'cancelled'
      session_id?: string
      output: string
      stop_reason?: string
      resume_rejected: false
      error?: { code: string; message: string }
    }
  | { v: typeof PROTOCOL_VERSION; type: 'protocol_error'; code: string; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed)
  const extra = Object.keys(value).filter(key => !allowedSet.has(key))
  if (extra.length > 0) throw new Error(`${field} contains unsupported field: ${extra.sort().join(', ')}`)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`)
  return value
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('expected string')
  return value
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer`)
  return Number(value)
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`)
  }
  return [...value]
}

function stringMap(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {}
  const record = assertRecord(value, field)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string') throw new Error(`${field}.${key} must be a string`)
    result[key] = item
  }
  return result
}

function parseModel(value: unknown): ModelSelectionInput | undefined {
  if (value === undefined || value === null) return undefined
  const model = assertRecord(value, 'model')
  assertOnlyKeys(model, ['provider', 'id', 'reasoning_effort'], 'model')
  return {
    provider: requiredString(model.provider, 'model.provider'),
    id: requiredString(model.id, 'model.id'),
    ...optionalString(model.reasoning_effort) === undefined
      ? {}
      : { reasoning_effort: optionalString(model.reasoning_effort) },
  }
}

function parseMcpServer(value: unknown, index: number): McpServerInput {
  const field = `mcp_servers[${index}]`
  const server = assertRecord(value, field)
  const transport = requiredString(server.transport, `${field}.transport`)
  const timeout = optionalPositiveInteger(server.tool_call_timeout_ms, `${field}.tool_call_timeout_ms`)
  if (transport === 'stdio') {
    assertOnlyKeys(server, ['name', 'transport', 'command', 'args', 'env', 'cwd', 'tool_call_timeout_ms'], field)
    return {
      name: requiredString(server.name, `${field}.name`),
      transport,
      command: requiredString(server.command, `${field}.command`),
      args: stringArray(server.args, `${field}.args`),
      env: stringMap(server.env, `${field}.env`),
      ...optionalString(server.cwd) === undefined ? {} : { cwd: optionalString(server.cwd) },
      ...timeout === undefined ? {} : { tool_call_timeout_ms: timeout },
    }
  }
  if (transport === 'streamable-http') {
    assertOnlyKeys(server, ['name', 'transport', 'url', 'headers', 'tool_call_timeout_ms'], field)
    return {
      name: requiredString(server.name, `${field}.name`),
      transport,
      url: requiredString(server.url, `${field}.url`),
      headers: stringMap(server.headers, `${field}.headers`),
      ...timeout === undefined ? {} : { tool_call_timeout_ms: timeout },
    }
  }
  throw new Error(`${field}.transport must be stdio or streamable-http`)
}

function parseMcpServers(value: unknown): McpServerInput[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('mcp_servers must be an array')
  return value.map(parseMcpServer)
}

export function parseInboundCommand(line: string): InboundCommand {
  if (Buffer.byteLength(line) > MAX_COMMAND_BYTES) throw new Error('protocol command exceeds 8 MiB')
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new Error('protocol command is not valid JSON')
  }
  const command = assertRecord(parsed, 'command')
  if (command.v !== PROTOCOL_VERSION) throw new Error(`unsupported protocol version: ${String(command.v)}`)
  const type = requiredString(command.type, 'command.type')
  if (type === 'cancel') {
    assertOnlyKeys(command, ['v', 'type', 'request_id'], 'cancel command')
    return {
      v: PROTOCOL_VERSION,
      type,
      request_id: requiredString(command.request_id, 'cancel.request_id'),
    }
  }
  if (type === 'execute') {
    assertOnlyKeys(
      command,
      ['v', 'type', 'request_id', 'cwd', 'prompt', 'resume_session_id', 'model', 'reasoning_effort', 'mcp_servers'],
      'execute command',
    )
    return {
      v: PROTOCOL_VERSION,
      type,
      request_id: requiredString(command.request_id, 'execute.request_id'),
      cwd: requiredString(command.cwd, 'execute.cwd'),
      prompt: requiredString(command.prompt, 'execute.prompt'),
      ...optionalString(command.resume_session_id) === undefined
        ? {}
        : { resume_session_id: optionalString(command.resume_session_id) },
      ...parseModel(command.model) === undefined ? {} : { model: parseModel(command.model) },
      ...optionalString(command.reasoning_effort) === undefined
        ? {}
        : { reasoning_effort: optionalString(command.reasoning_effort) },
      mcp_servers: parseMcpServers(command.mcp_servers),
    }
  }
  throw new Error(`unsupported protocol command type: ${type}`)
}

export function encodeFrame(frame: OutboundFrame): string {
  return `${JSON.stringify(frame)}\n`
}