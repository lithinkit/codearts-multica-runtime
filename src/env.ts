import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function getBasicAuth(): string {
  const user = process.env.OPENCODE_SERVER_USERNAME || 'codearts'
  const pass = process.env.OPENCODE_SERVER_PASSWORD
  if (!pass) throw new Error('OPENCODE_SERVER_PASSWORD is not set')
  return Buffer.from(`${user}:${pass}`).toString('base64')
}

function discoverPortFromConfig(): number | undefined {
  try {
    const agentDir = join(homedir(), '.codeartsdoer', 'CodeArts_Agent')
    const entries = readdirSync(agentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const configPath = join(agentDir, entry.name, 'server_config.properties')
      try {
        const content = readFileSync(configPath, 'utf8')
        const match = content.match(/^port=(\d+)$/m)
        if (match) {
          const port = parseInt(match[1], 10)
          if (Number.isInteger(port) && port >= 1 && port <= 65535) return port
        }
      } catch {
        continue
      }
    }
  } catch {
    // no config found
  }
  return undefined
}

export function getKernelPort(): number {
  const envPort = process.env.CODEARTS_KERNEL_PORT
  if (envPort !== undefined) {
    const parsed = parseInt(envPort, 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error('CODEARTS_KERNEL_PORT must be a valid port number (1-65535)')
    }
    return parsed
  }
  const discovered = discoverPortFromConfig()
  if (discovered !== undefined) return discovered
  return 49041
}

export function validateEnv(): void {
  getBasicAuth()
}