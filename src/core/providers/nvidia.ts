import type { ModelInfo } from '@shared/types'
import type { ChatRequest, ModelCache, Provider, StreamHandlers, StreamResult } from './types'
import { ProviderError } from './types'
import { streamCompat } from './openai-compat'

const BASE = 'https://integrate.api.nvidia.com/v1'
const TTL = 60 * 60 * 1000

export interface NvidiaDeps {
  getKey(): string | null
  cache: ModelCache
  fetchImpl?: typeof fetch
}

// Assumption: the NIM catalog at integrate.api.nvidia.com is accessible on the
// free tier with an nvapi key, subject to rate limits. The API exposes no price
// field, so free-tier handling is done via 429 backoff and fallback, not filtering.
export class NvidiaProvider implements Provider {
  id = 'nvidia' as const
  constructor(private deps: NvidiaDeps) {}

  async listModels(force: boolean): Promise<ModelInfo[]> {
    const key = this.deps.getKey()
    if (!key) return []
    const cached = this.deps.cache.get('nvidia')
    if (!force && cached && Date.now() - cached.ts < TTL) return cached.models
    const doFetch = this.deps.fetchImpl ?? fetch
    const res = await doFetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` } })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new ProviderError('Model catalog was not authorized.', res.status, false)
      throw new ProviderError('Model catalog request failed.', res.status, res.status === 429 || res.status >= 500)
    }
    const json: any = await res.json()
    const models: ModelInfo[] = (json.data ?? [])
      .map((m: any) => {
        const id = String(m.id)
        const params: string[] | null = Array.isArray(m.supported_parameters) ? m.supported_parameters : null
        const context = [m.context_length, m.context, m.max_context_length, m.max_input_tokens]
          .map(Number)
          .find((value) => Number.isFinite(value) && value > 0) ?? 0
        return {
          id,
          provider: 'nvidia' as const,
          name: id.split('/').pop() ?? id,
          context,
          capabilities: {
            code: /code|coder|starcoder|dev/i.test(id),
            reasoning: /r1|qwq|thinking|reason|nemotron/i.test(id),
            vision: /vision|vl|multimodal/i.test(id),
            tools: params ? params.includes('tools') || params.includes('tool_choice') : true
          }
        }
      })
      .filter((model: ModelInfo) => !/embed|rerank|reward|safety|guard/i.test(model.id))
      .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id))
    this.deps.cache.set('nvidia', models)
    return models
  }

  stream(req: ChatRequest, handlers: StreamHandlers): Promise<StreamResult> {
    const key = this.deps.getKey()
    if (!key) throw new ProviderError('This model is not connected. Choose another model.', 401, false)
    return streamCompat({ baseUrl: BASE, apiKey: key, provider: 'nvidia', fetchImpl: this.deps.fetchImpl }, req, handlers)
  }
}