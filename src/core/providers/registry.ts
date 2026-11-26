import type { ModelInfo, ProviderId } from '@shared/types'
import type { ChatRequest, ModelCache, Provider, StreamHandlers, StreamResult } from './types'
import { ProviderError } from './types'
import { NvidiaProvider } from './nvidia'
import { OpenRouterProvider } from './openrouter'

export interface RegistryDeps {
  getKey(provider: ProviderId): string | null
  cache: ModelCache
  fetchImpl?: typeof fetch
  onFallback?(from: string, to: string, reason: string): void
}

export class ProviderRegistry {
  private providers: Record<ProviderId, Provider>

  constructor(private deps: RegistryDeps) {
    this.providers = {
      nvidia: new NvidiaProvider({ getKey: () => deps.getKey('nvidia'), cache: deps.cache, fetchImpl: deps.fetchImpl }),
      openrouter: new OpenRouterProvider({ getKey: () => deps.getKey('openrouter'), cache: deps.cache, fetchImpl: deps.fetchImpl })
    }
  }

  async listAll(force: boolean): Promise<ModelInfo[]> {
    const results = await Promise.allSettled([
      this.providers.openrouter.listModels(force),
      this.providers.nvidia.listModels(force)
    ])
    const models: ModelInfo[] = []
    for (const r of results) if (r.status === 'fulfilled') models.push(...r.value)
    if (models.length === 0 && results.every((r) => r.status === 'rejected')) {
      const auth = results.find((r) => r.status === 'rejected' && r.reason instanceof ProviderError && (r.reason.status === 401 || r.reason.status === 403))
      if (auth?.status === 'rejected' && auth.reason instanceof ProviderError) {
        throw new ProviderError('Model connection was not authorized. Check the configured credential or choose another model.', auth.reason.status, false)
      }
      throw new ProviderError('Could not reach a model service. Check your connection.', 0, true)
    }
    return models.filter((model) => model.capabilities.tools)
  }

  // Try the chosen model first, then other free models on the same provider,
  // then the other provider. Rate limits and transient errors trigger fallback.
  async streamWithFallback(req: ChatRequest, handlers: StreamHandlers, preferred: ProviderId): Promise<StreamResult & { model: string; provider: ProviderId }> {
    if (!this.deps.getKey(preferred)) {
      throw new ProviderError('This model is not connected. Choose another model.', 401, false)
    }
    const candidates: { id: string; provider: ProviderId }[] = [{ id: req.model, provider: preferred }]
    const preferredModels = await this.providers[preferred].listModels(false)
      .catch((error: unknown) => {
        if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) {
          this.deps.cache.delete?.(preferred)
          throw error
        }
        return this.deps.cache.get(preferred)?.models ?? []
      })
    const selected = preferredModels.find((model) => model.id === req.model)
    if (!selected?.capabilities.tools) {
      throw new ProviderError('Selected model does not support tools or is unavailable.', 400, false)
    }
    const sameProvider = preferredModels
      .filter((m) => m.id !== req.model && m.capabilities.tools)
    const other: ProviderId = preferred === 'nvidia' ? 'openrouter' : 'nvidia'
    const otherModels = this.deps.getKey(other)
      ? await this.providers[other].listModels(false).catch(() => [])
      : []
    for (const m of sameProvider.slice(0, 4)) candidates.push({ id: m.id, provider: preferred })
    for (const m of otherModels.filter((model) => model.capabilities.tools).slice(0, 4)) candidates.push({ id: m.id, provider: other })

    let lastError: unknown = null
    for (const cand of candidates) {
      if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      try {
        const result = await this.providers[cand.provider].stream({ ...req, model: cand.id }, handlers)
        if (cand.id !== req.model || cand.provider !== preferred) {
          this.deps.onFallback?.(req.model, cand.id, 'transient provider error')
        }
        return { ...result, model: cand.id, provider: cand.provider }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        lastError = err
        if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) {
          this.deps.cache.delete?.(cand.provider)
        }
        const retryable = err instanceof ProviderError ? err.retryable : true
        if (!retryable) break
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError('All providers failed.', 0, true)
  }
}