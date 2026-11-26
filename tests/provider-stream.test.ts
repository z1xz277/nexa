import assert from 'node:assert/strict'
import test from 'node:test'
import { streamCompat } from '../src/core/providers/openai-compat.ts'
import { ProviderError, type ChatRequest } from '../src/core/providers/types.ts'

const request: ChatRequest = {
  model: 'test/model',
  messages: [{ role: 'user', content: 'hello' }],
  effort: 'low'
}

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}

function response(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function run(chunks: string[], handlers = { onChunk(_text: string) {} }) {
  return streamCompat({
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'test-key',
    provider: 'openrouter',
    fetchImpl: async () => response(chunks)
  }, request, handlers)
}

test('a valid finish reason closes a stream without a DONE marker', async () => {
  const result = await run([
    sse({ choices: [{ delta: { content: 'hello' }, finish_reason: null }] }),
    sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })
  ])
  assert.equal(result.text, 'hello')
  assert.deepEqual(result.toolCalls, [])
})

test('a DONE marker closes a valid stream', async () => {
  const result = await run([
    sse({ choices: [{ delta: { content: 'hello' }, finish_reason: null }] }),
    'data: [DONE]\n\n'
  ])
  assert.equal(result.text, 'hello')
})

test('malformed stream JSON fails closed', async () => {
  await assert.rejects(run(['data: {not-json}\n\n']), /invalid stream/i)
})

test('provider error events fail closed without echoing the payload', async () => {
  await assert.rejects(
    run([sse({ error: { message: 'opaque-provider-credential' } })]),
    (error: unknown) => error instanceof Error && /invalid stream/i.test(error.message) && !error.message.includes('opaque-provider-credential')
  )
})

test('a truncated stream without a finish marker fails closed', async () => {
  await assert.rejects(
    run([sse({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] })]),
    /ended before completion/i
  )
})

test('an oversized stream event fails closed', async () => {
  await assert.rejects(
    run([sse({ choices: [{ delta: { content: 'x'.repeat(1_100_000) }, finish_reason: null }] })]),
    /stream event/i
  )
})

test('tool calls require an id, a safe name, and complete object arguments', async (t) => {
  const invalid = [
    { index: 0, function: { name: 'read_file', arguments: '{}' } },
    { index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"path":' } },
    { index: 0, id: 'call-1', function: { name: 'read_file', arguments: '[]' } },
    { index: 0, id: 'call-1', function: { name: 'read file', arguments: '{}' } }
  ]
  for (const toolCall of invalid) {
    await t.test(JSON.stringify(toolCall), async () => {
      await assert.rejects(run([
        sse({ choices: [{ delta: { tool_calls: [toolCall] }, finish_reason: null }] }),
        sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      ]), /invalid tool call/i)
    })
  }
})

test('fragmented tool calls are assembled and validated', async () => {
  const result = await run([
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_', arguments: '{"path":' } }] }, finish_reason: null }] }),
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: '"a.txt"}' } }] }, finish_reason: null }] }),
    sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  ])
  assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}' }])
})

test('authentication failures are neutral, non-retryable, and make one request', async () => {
  for (const status of [401, 403]) {
    let requests = 0
    await assert.rejects(
      streamCompat({
        baseUrl: 'https://provider.invalid/v1', apiKey: 'test-key', provider: 'nvidia',
        fetchImpl: async () => { requests++; return new Response('denied', { status }) }
      }, request, { onChunk() {} }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError)
        assert.equal(error.status, status)
        assert.equal(error.retryable, false)
        assert.match(error.message, /not authorized/i)
        assert.doesNotMatch(error.message, /nvidia|openrouter|provider error/i)
        return true
      }
    )
    assert.equal(requests, 1)
  }
})

test('abort interrupts a pending provider read', { timeout: 1000 }, async () => {
  const controller = new AbortController()
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start() {
      setTimeout(() => controller.abort(), 20)
    }
  }), { status: 200 })
  const pending = streamCompat({
    baseUrl: 'https://provider.invalid/v1', apiKey: 'test-key', provider: 'openrouter', fetchImpl
  }, { ...request, signal: controller.signal }, { onChunk() {} })
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError')
})
