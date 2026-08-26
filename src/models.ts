import type { CodeArtsClient } from './client.js'
import { encodeFrame, PROTOCOL_VERSION, type RuntimeModelFrame } from './protocol.js'

export async function handleListModels(client: CodeArtsClient): Promise<number> {
  try {
    const models = await client.listModels()
    const frames: RuntimeModelFrame[] = models.map(m => ({
      id: m.id,
      label: m.display_name ?? m.id,
      provider: m.provider_id ?? 'unknown',
      ...(m.context_window !== undefined ? { context_window: m.context_window } : {}),
    }))
    process.stdout.write(encodeFrame({
      v: PROTOCOL_VERSION,
      type: 'models',
      models: frames,
    }))
    return 0
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    process.stderr.write(`codearts-multica-runtime: model discovery failed: ${msg}\n`)
    process.stdout.write(encodeFrame({
      v: PROTOCOL_VERSION,
      type: 'models',
      models: [],
    }))
    return 1
  }
}