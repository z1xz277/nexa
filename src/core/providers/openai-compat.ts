import { EFFORT_POLICIES } from '../effort'
import type { ChatRequest, StreamHandlers, StreamResult, ToolCall } from './types'
import { ProviderError } from './types'

export interface CompatConfig {
  baseUrl: string
  apiKey: string
  provider: 'nvidia' | 'openrouter'
  fetchImpl?: typeof fetch
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

function buildBody(cfg: CompatConfig, req: ChatRequest, degraded: boolean): Record<string, unknown> {
  const policy = EFFORT_POLICIES[req.effort]
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    max_tokens: policy.maxTokens,
    stream: true
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: t }))
    body.tool_choice = 'auto'
  }
  if (!degraded) {
    if (cfg.provider === 'openrouter') {
      // OpenRouter accepts usage accounting and a normalized reasoning hint.
      body.stream_options = { include_usage: true }
      if (policy.reasoning) body.reasoning = { effort: policy.reasoning }
    } else if (policy.reasoning && /r1|qwq|thinking|reason|nemotron/i.test(req.model)) {
      // NIM reasoning families accept a thinking toggle via chat template kwargs.
      body.chat_template_kwargs = { thinking: true }
    }
  }
  return body
}

// One SSE reader for both OpenAI-compatible endpoints. Retries with exponential
// backoff on 429 and 5xx, honors Retry-After, and degrades optional params on 400.
export async function streamCompat(
  cfg: CompatConfig,
  req: ChatRequest,
  handlers: StreamHandlers
): Promise<StreamResult> {
  const doFetch = cfg.fetchImpl ?? fetch
  let degraded = false
  let attempt = 0
  const maxAttempts = 4

  for (;;) {
    attempt++
    let res: Response
    try {
      res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
          ...(cfg.provider === 'openrouter' ? { 'X-Title': 'Nexa' } : {})
        },
        body: JSON.stringify(buildBody(cfg, req, degraded)),
        signal: req.signal
      })
    } catch (err) {
      if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (attempt >= maxAttempts) throw new ProviderError('Network error, retries exhausted.', 0, true)
      await sleep(500 * 2 ** attempt + Math.random() * 250, req.signal)
      continue
    }

    if (res.status === 400 && !degraded) {
      // Optional params rejected by this model: retry once with a plain body.
      degraded = true
      attempt = 0
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxAttempts) {
        throw new ProviderError(
          res.status === 429 ? 'Provider rate limit reached.' : `Provider error ${res.status}.`,
          res.status,
          true
        )
      }
      const retryAfter = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 700 * 2 ** attempt + Math.random() * 300
      await sleep(Math.min(wait, 15000), req.signal)
      continue
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {})
      throw new ProviderError('Model connection was not authorized. Check the configured credential or choose another model.', res.status, false)
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {})
      throw new ProviderError(`Provider error ${res.status}.`, res.status, false)
    }

    return readSse(res.body, req.signal, handlers)
  }
}

const MAX_STREAM_BYTES = 8 * 1024 * 1024
const MAX_EVENT_CHARS = 1024 * 1024
const MAX_TEXT_CHARS = 2 * 1024 * 1024
const MAX_TOOL_ARGS_CHARS = 256 * 1024
const MAX_TOOL_CALLS = 32

function invalidStream(): ProviderError {
  return new ProviderError('Provider returned an invalid stream.', 502, false)
}

function invalidToolCall(): ProviderError {
  return new ProviderError('Provider returned an invalid tool call.', 502, false)
}

async function readNext(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new DOMException('Aborted', 'AbortError'))
      void reader.cancel().catch(() => {})
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([reader.read(), aborted])
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  handlers: StreamHandlers
): Promise<StreamResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let eventChars = 0
  let totalBytes = 0
  let text = ''
  let tokens = 0
  let sawDone = false
  let sawChoice = false
  let finishReason: string | null = null
  const calls = new Map<number, ToolCall>()

  const dispatch = (payload: string) => {
    const trimmed = payload.trim()
    if (!trimmed) return
    if (sawDone) throw invalidStream()
    if (trimmed === '[DONE]') {
      sawDone = true
      return
    }
    let json: any
    try { json = JSON.parse(trimmed) } catch { throw invalidStream() }
    if (!json || typeof json !== 'object' || Array.isArray(json) || json.error) throw invalidStream()
    if (json.usage !== undefined) {
      const usage = json.usage.total_tokens
      if (typeof usage !== 'number' || !Number.isFinite(usage) || usage < 0) throw invalidStream()
      tokens = Math.floor(usage)
    }
    if (json.choices === undefined) return
    if (!Array.isArray(json.choices)) throw invalidStream()
    const choice = json.choices[0]
    if (json.choices.length > 0 && (!choice || typeof choice !== 'object' || Array.isArray(choice))) throw invalidStream()
    if (!choice) return
    sawChoice = true
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      if (typeof choice.finish_reason !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(choice.finish_reason)) throw invalidStream()
      finishReason = choice.finish_reason
    }
    const delta = choice.delta
    if (delta === undefined || delta === null) return
    if (typeof delta !== 'object' || Array.isArray(delta)) throw invalidStream()
    if (delta.content !== undefined && delta.content !== null) {
      if (typeof delta.content !== 'string') throw invalidStream()
      if (text.length + delta.content.length > MAX_TEXT_CHARS) throw invalidStream()
      if (delta.content) {
        text += delta.content
        handlers.onChunk(delta.content)
      }
    }
    if (delta.tool_calls === undefined || delta.tool_calls === null) return
    if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > MAX_TOOL_CALLS) throw invalidToolCall()
    for (const tc of delta.tool_calls) {
      if (!tc || typeof tc !== 'object' || Array.isArray(tc)) throw invalidToolCall()
      if (!Number.isInteger(tc.index) || tc.index < 0 || tc.index >= MAX_TOOL_CALLS) throw invalidToolCall()
      const index = tc.index as number
      const cur = calls.get(index) ?? { id: '', name: '', arguments: '' }
      if (tc.id !== undefined) {
        if (typeof tc.id !== 'string' || !tc.id || tc.id.length > 200 || /[\u0000-\u001f\u007f]/.test(tc.id)) throw invalidToolCall()
        if (cur.id && cur.id !== tc.id) throw invalidToolCall()
        cur.id = tc.id
      }
      if (tc.function !== undefined) {
        if (!tc.function || typeof tc.function !== 'object' || Array.isArray(tc.function)) throw invalidToolCall()
        if (tc.function.name !== undefined) {
          if (typeof tc.function.name !== 'string') throw invalidToolCall()
          cur.name += tc.function.name
          if (cur.name.length > 100) throw invalidToolCall()
        }
        if (tc.function.arguments !== undefined) {
          if (typeof tc.function.arguments !== 'string') throw invalidToolCall()
          cur.arguments += tc.function.arguments
          if (cur.arguments.length > MAX_TOOL_ARGS_CHARS) throw invalidToolCall()
        }
      }
      calls.set(index, cur)
    }
  }

  const handleLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line) {
      if (dataLines.length) dispatch(dataLines.join('\n'))
      dataLines = []
      eventChars = 0
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') {
      eventChars += value.length + 1
      if (eventChars > MAX_EVENT_CHARS) throw new ProviderError('Provider stream event exceeded the size limit.', 502, false)
      dataLines.push(value)
    }
  }

  try {
    for (;;) {
      const { done, value } = await readNext(reader, signal)
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_STREAM_BYTES) throw new ProviderError('Provider stream exceeded the size limit.', 502, false)
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_EVENT_CHARS && !buffer.includes('\n')) {
        throw new ProviderError('Provider stream event exceeded the size limit.', 502, false)
      }
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
      }
    }
    buffer += decoder.decode()
    if (buffer) handleLine(buffer)
    if (dataLines.length) dispatch(dataLines.join('\n'))
  } finally {
    reader.releaseLock()
  }

  if (!sawChoice || (!sawDone && !finishReason)) {
    throw new ProviderError('Provider stream ended before completion.', 502, false)
  }
  const ids = new Set<string>()
  const toolCalls: ToolCall[] = []
  for (const call of calls.values()) {
    if (!call.id || ids.has(call.id) || !/^[a-z0-9_.-]{1,100}$/i.test(call.name)) throw invalidToolCall()
    let args: unknown
    try { args = JSON.parse(call.arguments) } catch { throw invalidToolCall() }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidToolCall()
    ids.add(call.id)
    toolCalls.push(call)
  }
  if (!tokens) tokens = Math.ceil(text.length / 4)
  return { text, toolCalls, tokens }
}