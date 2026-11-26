import type { ModelInfo } from '@shared/types'
import type { ChatRequest, ModelCache, Provider, StreamHandlers, StreamResult } from './types'
import { ProviderError } from './types'
import { streamCompat } from './openai-compat'

const BASE = 'https://openrouter.ai/api/v1'
const TTL = 60 * 60 * 1000

export interface OpenRouterDeps {
  getKey(): string | null
  cache: ModelCache
  fetchImpl?: typeof fetch
}

export class OpenRouterProvider implements Provider {
  id = 'openrouter' as const
  constructor(private deps: OpenRouterDeps) {}

  async listModels(force: boolean): Promise<ModelInfo[]> {
    const cached = this.deps.cache.get('openrouter')
    if (!force && cached && Date.now() - cached.ts < TTL) return cached.models
    const doFetch = this.deps.fetchImpl ?? fetch
    // The catalog endpoint is public; no key is needed to browse free models.
    const res = await doFetch(`${BASE}/models`)
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new ProviderError('Model catalog was not authorized.', res.status, false)
      throw new ProviderError('Model catalog request failed.', res.status, res.status === 429 || res.status >= 500)
    }
    const json: any = await res.json()
    const models: ModelInfo[] = (json.data ?? [])
      .filter((m: any) => {
        const p = m.pricing ?? {}
        return Number(p.prompt) === 0 && Number(p.completion) === 0
      })
      .map((m: any) => {
        const params: string[] = m.supported_parameters ?? []
        const modalities: string[] = m.architecture?.input_modalities ?? ['text']
        const id = String(m.id)
        return {
          id,
          provider: 'openrouter' as const,
          name: m.name ?? id,
          context: m.context_length ?? 0,
          capabilities: {
            code: /code|coder|dev|program/i.test(id + ' ' + (m.name ?? '')),
            reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
            vision: modalities.includes('image'),
            tools: params.includes('tools')
          }
        }
      })
      .sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name))
    this.deps.cache.set('openrouter', models)
    return models
  }

  stream(req: ChatRequest, handlers: StreamHandlers): Promise<StreamResult> {
    const key = this.deps.getKey()
    if (!key) throw new ProviderError('This model is not connected. Choose another model.', 401, false)
    return streamCompat({ baseUrl: BASE, apiKey: key, provider: 'openrouter', fetchImpl: this.deps.fetchImpl }, req, handlers)
  }
}