import type { OutboundFrame } from './protocol.js'

let sessionId: string | undefined
let requestId: string | undefined
let promptText: string | undefined
let promptEchoSkipped = false

export function opencodeInit(sid: string, rid: string): void {
  sessionId = sid
  requestId = rid
}

export function opencodeSetPrompt(prompt: string): void {
  promptText = prompt
  promptEchoSkipped = false
}

export function toOpenCodeFrame(frame: OutboundFrame): string {
  const ts = Date.now()

  switch (frame.type) {
    case 'ready':
      return ''

    case 'session':
      sessionId = frame.session_id
      return JSON.stringify({
        type: 'step_start',
        timestamp: ts,
        sessionID: frame.session_id,
        part: { id: `part_${ts}`, messageID: `msg_${ts}`, sessionID: frame.session_id, type: 'step-start' },
      }) + '\n'

    case 'thinking':
      return JSON.stringify({
        type: 'thinking',
        timestamp: ts,
        sessionID: sessionId,
        part: { id: `part_${ts}_t`, messageID: `msg_${ts}_t`, sessionID: sessionId, type: 'reasoning', text: frame.content, time: { start: ts, end: ts + 1 } },
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
        part: { id: `part_${ts}_x`, messageID: `msg_${ts}_x`, sessionID: sessionId, type: 'text', text: frame.content, time: { start: ts, end: ts + 1 } },
      }) + '\n'
    }

    case 'tool_call':
      return JSON.stringify({
        type: 'tool_use',
        timestamp: ts,
        sessionID: sessionId,
        part: { id: `part_${ts}_c`, messageID: `msg_${ts}_c`, sessionID: sessionId, type: 'tool_use', name: frame.name, input: frame.arguments, callID: frame.call_id },
      }) + '\n'

    case 'tool_result':
      return JSON.stringify({
        type: 'tool_result',
        timestamp: ts,
        sessionID: sessionId,
        part: { id: `part_${ts}_r`, messageID: `msg_${ts}_r`, sessionID: sessionId, type: 'tool_result', callID: frame.call_id, output: frame.output, isError: frame.is_error },
      }) + '\n'

    case 'usage':
      // Usage is included in step_finish, skip standalone
      return ''

    case 'result': {
      const info: Record<string, unknown> = {
        id: `msg_res_${ts}`,
        role: 'assistant',
        time: { created: ts, completed: ts + 1 },
        sessionID: sessionId,
        finish: frame.status === 'completed' ? 'stop' : 'error',
      }
      if (frame.output) {
        info.summary = { text: frame.output.slice(0, 200) }
      }
      return JSON.stringify({
        type: 'step_finish',
        timestamp: ts,
        sessionID: sessionId,
        part: {
          id: `part_${ts}_f`,
          reason: frame.status === 'completed' ? 'stop' : 'error',
          messageID: `msg_${ts}_f`,
          sessionID: sessionId,
          type: 'step-finish',
        },
        info,
      }) + '\n'
    }

    case 'protocol_error':
      return JSON.stringify({
        type: 'step_finish',
        timestamp: ts,
        sessionID: sessionId,
        part: { id: `part_${ts}_e`, reason: 'error', messageID: `msg_${ts}_e`, sessionID: sessionId, type: 'step-finish' },
        info: { id: `msg_${ts}_e`, role: 'assistant', finish: 'error', sessionID: sessionId },
      }) + '\n'

    default:
      return ''
  }
}