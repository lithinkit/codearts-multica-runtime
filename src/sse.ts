export type SSEEventType = 'message.part.updated' | 'message.part.delta' | 'message.updated' | 'session.created' | 'session.error' | 'server.connected' | 'server.heartbeat'

export interface SSEEvent {
  type: SSEEventType
  properties: Record<string, unknown>
}

interface SSEEventRaw {
  data?: string
}

function extractSSEEvents(buffer: string): SSEEventRaw[] {
  const events: SSEEventRaw[] = []
  const blocks = buffer.split('\n\n')
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i]
    if (block.trim() === '') continue
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (data) events.push({ data })
      }
    }
  }
  return events
}

const KNOWN_TYPES = new Set<string>([
  'message.part.updated', 'message.part.delta', 'message.updated',
  'session.created', 'session.error', 'server.connected', 'server.heartbeat',
])

function parseEvent(raw: SSEEventRaw): SSEEvent | null {
  if (!raw.data) return null
  try {
    const parsed = JSON.parse(raw.data)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const type = parsed.type as string | undefined
    if (!type || !KNOWN_TYPES.has(type)) return null
    return {
      type: type as SSEEventType,
      properties: (parsed.properties as Record<string, unknown>) ?? {},
    }
  } catch {
    return null
  }
}

export async function* parseSSE(response: Response): AsyncGenerator<SSEEvent> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response body is not readable')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const rawEvents = extractSSEEvents(buffer)
      buffer = buffer.slice(Math.max(0, buffer.lastIndexOf('\n\n') + 2))

      for (const raw of rawEvents) {
        const event = parseEvent(raw)
        if (event) yield event
      }
    }

    const remaining = extractSSEEvents(buffer + '\n\n')
    for (const raw of remaining) {
      const event = parseEvent(raw)
      if (event) yield event
    }
  } finally {
    reader.releaseLock()
  }
}