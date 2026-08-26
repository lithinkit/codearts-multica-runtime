import type { CodeArtsClient } from './client.js'
import { encodeFrame, PROTOCOL_VERSION } from './protocol.js'

const PLUGIN_VERSION = '1.0.0'

export async function handleProbe(client: CodeArtsClient): Promise<number> {
  let healthy = false
  let kernelVersion: string | undefined
  try {
    const h = await client.health()
    kernelVersion = h.version
    healthy = h.status === 'healthy'
  } catch {
    healthy = false
  }
  process.stdout.write(encodeFrame({
    v: PROTOCOL_VERSION,
    type: 'probe',
    runtime: 'codearts',
    plugin_version: PLUGIN_VERSION,
    protocol_version: PROTOCOL_VERSION,
  }))
  return healthy ? 0 : 1
}