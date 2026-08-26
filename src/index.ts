import { CodeArtsClient } from './client.js'
import { handleProbe } from './probe.js'
import { handleListModels } from './models.js'
import { handleStdio } from './execute.js'

function parseMode(args: readonly string[]): 'stdio' | 'probe' | 'list-models' {
  if (args.length === 0) throw new Error('expected at least one mode argument')
  const first = args[0]
  switch (first) {
    case '--stdio': case 'run':    return 'stdio'
    case '--probe': case 'probe':  return 'probe'
    case '--list-models': case 'list-models': return 'list-models'
    default: throw new Error(`unsupported mode: ${first}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const mode = parseMode(args)

  const client = new CodeArtsClient()

  let code = 1
  try {
    switch (mode) {
      case 'probe':
        code = await handleProbe(client)
        break
      case 'list-models':
        code = await handleListModels(client)
        break
      case 'stdio':
        code = await handleStdio(client)
        break
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    process.stderr.write(`codearts-multica-runtime: ${msg}\n`)
    code = 1
  }
  process.exit(code)
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error)
  process.stderr.write(`codearts-multica-runtime: fatal: ${msg}\n`)
  process.exit(1)
})