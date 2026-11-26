import assert from 'node:assert/strict'
import test from 'node:test'
import { ProviderRegistry } from '../src/core/providers/registry.ts'
import { NvidiaProvider } from '../src/core/providers/nvidia.ts'
import { ProviderError, type ModelCache } from '../src/core/providers/types.ts'

const cache: ModelCache = { get: () => null, set() {} }
const catalog: Response = Response.json({
  data: [
    {
      id: 'vendor/chat-only', name: 'Chat only', context_length: 8192,
      pricing: { prompt: '0', completion: '0' }, supported_parameters: []
    },
    {
      id: 'vendor/tool-chat', name: 'Tool chat', context_length: 8192,
      pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools']
    }
  ]
})

test('the selectable catalog excludes models without tool support', async () => {
  const registry = new ProviderRegistry({
    getKey: () => null,
    cache,
    fetchImpl: async () => catalog.clone()
  })
  const models = await registry.listAll(false)
  assert.deepEqual(models.map((model) => model.id), ['vendor/tool-chat'])
})

test('NVIDIA catalogs preserve context and declared tool capability', async () => {
  const provider = new NvidiaProvider({
    getKey: () => 'test-key',
    cache,
    fetchImpl: async () => Response.json({
      data: [
        { id: 'vendor/chat', context_length: 131072, supported_parameters: [] },
        { id: 'vendor/tools', context: 65536, supported_parameters: ['tools'] }
      ]
    })
  })
  const models = await provider.listModels(true)
  assert.equal(models.find((model) => model.id === 'vendor/chat')?.context, 131072)
  assert.equal(models.find((model) => model.id === 'vendor/chat')?.capabilities.tools, false)
  assert.equal(models.find((model) => model.id === 'vendor/tools')?.context, 65536)
  assert.equal(models.find((model) => model.id === 'vendor/tools')?.capabilities.tools, true)
})

test('catalog authentication errors do not fall through to stale models and chat', async () => {
  const calls: string[] = []
  const stale: ModelCache = {
    get: (provider) => provider === 'nvidia' ? {
      ts: 1,
      models: [{ id: 'vendor/model', provider: 'nvidia', name: 'Model', context: 8192, capabilities: { code: true, reasoning: false, vision: false, tools: true } }]
    } : null,
    set() {}
  }
  const registry = new ProviderRegistry({
    getKey: (provider) => provider === 'nvidia' ? 'test-key' : null,
    cache: stale,
    fetchImpl: async (input) => { calls.push(String(input)); return new Response('denied', { status: 401 }) }
  })
  await assert.rejects(registry.streamWithFallback({
    model: 'vendor/model', messages: [{ role: 'user', content: 'hello' }], effort: 'low'
  }, { onChunk() {} }, 'nvidia'), (error: unknown) => error instanceof ProviderError && error.status === 401 && /not authorized/i.test(error.message))
  assert.deepEqual(calls, ['https://integrate.api.nvidia.com/v1/models'])
})

test('chat authentication failures invalidate the affected model cache', async () => {
  const invalidated: string[] = []
  const fresh: ModelCache = {
    get: (provider) => provider === 'nvidia' ? {
      ts: Date.now(),
      models: [{ id: 'vendor/model', provider: 'nvidia', name: 'Model', context: 8192, capabilities: { code: true, reasoning: false, vision: false, tools: true } }]
    } : null,
    set() {},
    delete: (provider) => { invalidated.push(provider) }
  }
  const registry = new ProviderRegistry({
    getKey: (provider) => provider === 'nvidia' ? 'test-key' : null,
    cache: fresh,
    fetchImpl: async () => new Response('denied', { status: 401 })
  })
  await assert.rejects(registry.streamWithFallback({
    model: 'vendor/model', messages: [{ role: 'user', content: 'hello' }], effort: 'low'
  }, { onChunk() {} }, 'nvidia'), /not authorized/i)
  assert.deepEqual(invalidated, ['nvidia'])
})

test('a tool-incompatible selected model cannot start an agent run', async () => {
  let chatRequests = 0
  const registry = new ProviderRegistry({
    getKey: () => 'test-key',
    cache,
    fetchImpl: async (input) => {
      if (String(input).endsWith('/models')) return catalog.clone()
      chatRequests++
      return new Response('data: {"choices":[{"delta":{"content":"unexpected"},"finish_reason":null}]}\n\ndata: [DONE]\n\n', { status: 200 })
    }
  })
  await assert.rejects(registry.streamWithFallback({
    model: 'vendor/chat-only',
    messages: [{ role: 'user', content: 'hello' }],
    effort: 'low'
  }, { onChunk() {} }, 'openrouter'), /does not support tools/i)
  assert.equal(chatRequests, 0)
})
