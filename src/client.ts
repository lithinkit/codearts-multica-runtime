import { getBasicAuth, getKernelPort } from './env.js'

export interface HealthResponse {
  status: string
  version?: string
}

export interface ModelInfo {
  id: string
  provider_id?: string
  context_window?: number
  display_name?: string
}

interface CodeArtsModel {
  model_id: string
  provider: string
  provider_type: string
  model_name: string
  context_window?: number
}

interface ModelsResponse {
  models: CodeArtsModel[]
}

export enum SessionStatus {
  ACTIVE = 'active',
  IDLE = 'idle',
  COMPLETED = 'completed',
}

export interface Session {
  id: string
  status?: SessionStatus
  cwd?: string
}

interface CodeArtsSession {
  id: string
  status?: string
  cwd?: string
}

export interface CodeArtsClientOptions {
  baseUrl?: string
  timeoutMs?: number
}

export class CodeArtsClient {
  private readonly baseUrl: string
  private readonly auth: string
  private readonly timeoutMs: number

  constructor(options: CodeArtsClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? `http://localhost:${getKernelPort()}`
    this.auth = getBasicAuth()
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Basic ${this.auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
        signal: controller.signal,
      })
      if (response.status === 401) throw new Error('authentication failed — check OPENCODE_SERVER_PASSWORD')
      if (response.status === 503) throw new Error('kernel is not running at ' + this.baseUrl)
      if (!response.ok) {
        let body = ''
        try { body = await response.text() } catch { /* ignore */ }
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`)
      }
      if (response.status === 204) return undefined as T
      return response.json() as Promise<T>
    } finally {
      clearTimeout(timer)
    }
  }

  async health(): Promise<HealthResponse> {
    const response = await this.request<{ healthy: boolean; version?: string }>('/global/health')
    const status = response.healthy ? 'healthy' : 'unhealthy'
    return { status, version: response.version }
  }

  async listModels(): Promise<ModelInfo[]> {
    const data = await this.request<ModelsResponse>('/cag/model')
    return data.models.map(item => ({
      id: item.model_id,
      provider_id: item.provider_type,
      context_window: item.context_window,
      display_name: item.model_name,
    }))
  }

  async createSession(cwd: string): Promise<Session> {
    // Query param is how kernel sets session directory
    const dir = cwd.replace(/\\/g, '/')
    const data = await this.request<CodeArtsSession>(`/cag/session?directory=${encodeURIComponent(dir)}`, {
      method: 'POST',
      body: JSON.stringify({ root: '/' }),
    })
    return {
      id: data.id,
      status: (data.status as SessionStatus) ?? SessionStatus.ACTIVE,
      cwd: data.cwd,
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.request<void>(`/session/${sessionId}`, { method: 'DELETE' })
    } catch {
      // ignore cleanup errors
    }
  }

  async sendPrompt(sessionId: string, prompt: string, model?: ModelInfo): Promise<void> {
    const body: Record<string, unknown> = {
      prompt,
      parts: [{ type: 'text', text: prompt }],
      agent: 'build',
    }
    if (model) {
      body.model = {
        modelID: model.id,
        providerID: model.provider_id ?? 'openai-9716a4a24ed8902d',
      }
    }
    await this.request<void>(`/session/${sessionId}/prompt_async`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async connectSSE(): Promise<Response> {
    const controller = new AbortController()
    const response = await fetch(`${this.baseUrl}/event`, {
      headers: {
        Authorization: `Basic ${this.auth}`,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      let body = ''
      try { body = await response.text() } catch { /* ignore */ }
      throw new Error(`SSE connection failed: HTTP ${response.status}: ${body.slice(0, 200)}`)
    }
    return response
  }
}