import type { OutboundFrame } from './protocol.js'

let sessionId: string | undefined
let requestId: string | undefined
let promptText: string | undefined
let promptEchoSkipped = false
let latestUsage: { input_tokens?: number; output_tokens?: number; reasoning_tokens?: number; cache_read_tokens?: number; cache_write_tokens?: number } = {}
let partSeq = 0

function nextSeq(): number { return ++partSeq }

export function opencodeInit(sid: string, rid: string): void {
  sessionId = sid
  requestId = rid
  latestUsage = {}
  partSeq = 0
}

export function opencodeSetPrompt(prompt: string): void {
  promptText = prompt
  promptEchoSkipped = false
}

export function toOpenCodeFrame(frame: OutboundFrame): string {
  const ts = Date.now()
  const seq = nextSeq()

  switch (frame.type) {
    case 'ready':
      return ''

    case 'session':
      sessionId = frame.session_id
      return JSON.stringify({
        type: 'step_start',
        timestamp: ts,
        sessionID: frame.session_id,
        part: { id: `prt_${seq}`, messageID: `msg_${seq}`, sessionID: frame.session_id, type: 'step-start' },
      }) + '\n'

    case 'thinking':
      return JSON.stringify({
        type: 'thinking',
        timestamp: ts,
        sessionID: sessionId,
        part: { id: `prt_${seq}`, messageID: `msg_thinking_${seq}`, sessionID: sessionId, type: 'reasoning', text: frame.content, time: { start: ts, end: ts + 1 } },
      }) + '\n'

    case 'text': {
      if (frame.content.includes('<system-reminder>') || frame.content.includes('</system-reminder>')) return ''
      if (!promptEchoSkipped && promptText && frame.content.trim() === promptText.trim()) {
        promptEchoSkipped = true
        return ''
      }
      promptEchoSkipped = true
      return JSON.stringify({
        type: 'text',
        timestamp: ts,
        sessionID: sessionId,
        part: { id: `prt_${seq}`, messageID: `msg_text_${seq}`, sessionID: sessionId, type: 'text', text: frame.content, time: { start: ts, end: ts + 1 } },
      }) + '\n'
    }

    case 'tool_call':
    case 'tool_result':
      // Kernel handles tools internally; don't forward to opencode daemon
      return ''

    case 'usage':
      latestUsage = {
        input_tokens: frame.input_tokens,
        output_tokens: frame.output_tokens,
        reasoning_tokens: frame.reasoning_tokens,
        cache_read_tokens: frame.cache_read_tokens,
        cache_write_tokens: frame.cache_write_tokens,
      }
      return ''

    case 'result': {
      const tokens: Record<string, number> = {}
      if (latestUsage.input_tokens) tokens.input = latestUsage.input_tokens
      if (latestUsage.output_tokens) tokens.output = latestUsage.output_tokens
      if (latestUsage.reasoning_tokens) tokens.reasoning = latestUsage.reasoning_tokens
      const cache: Record<string, number> = {}
      if (latestUsage.cache_read_tokens) cache.read = latestUsage.cache_read_tokens
      if (latestUsage.cache_write_tokens) cache.write = latestUsage.cache_write_tokens
      if (Object.keys(cache).length > 0) tokens.cache = cache as unknown as number
      return JSON.stringify({
        type: 'step_finish',
        timestamp: ts,
        sessionID: sessionId,
        part: {
          id: `prt_${seq}`,
          reason: frame.status === 'completed' ? 'stop' : 'error',
          messageID: `msg_final_${seq}`,
          sessionID: sessionId,
          type: 'step-finish',
          ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
          cost: 0,
        },
      }) + '\n'
    }

    case 'protocol_error':
      return JSON.stringify({
        type: 'step_finish',
        timestamp: ts,
        sessionID: sessionId,
        part: {
          id: `prt_${seq}`,
          reason: 'error',
          messageID: `msg_err_${seq}`,
          sessionID: sessionId,
          type: 'step-finish',
          tokens: {},
          cost: 0,
        },
      }) + '\n'

    default:
      return ''
  }
}