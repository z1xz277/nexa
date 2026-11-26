const SECRET_PATTERNS: RegExp[] = [
  /nvapi-[A-Za-z0-9_-]{8,}/g,
  /sk-or-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /(Bearer\s+)[A-Za-z0-9._-]{12,}/gi,
  /("?(?:api[_-]?key|authorization|token)"?\s*[:=]\s*"?)[^"\s,}]{8,}/gi
]

export function redactText(input: string, secrets: readonly string[] = []): string {
  let out = input
  const values = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)
  for (const value of values) out = out.split(value).join('[REDACTED]')
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix) => prefix ? `${prefix}[REDACTED]` : '[REDACTED]')
  }
  return out
}

export function redactDeep(value: unknown, source: SecretSource = []): unknown {
  const secrets = currentSecrets(source)
  if (typeof value === 'string') return redactText(value, secrets)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = /key|token|secret|authorization/i.test(key) ? '[REDACTED]' : redactDeep(item, secrets)
    }
    return out
  }
  return value
}

export type SecretSource = readonly string[] | (() => readonly string[])

function currentSecrets(source: SecretSource): readonly string[] {
  return typeof source === 'function' ? source() : source
}

export class SecretHistory {
  private known = new Set<string>()

  track(source: SecretSource): string[] {
    for (const value of currentSecrets(source)) {
      if (value) this.known.add(value)
    }
    return [...this.known]
  }
}

const STREAM_SECRET_START = /nvapi-|sk-or-|sk-|Bearer[ \t]+|"?((?:api[_-]?key|authorization|token)"?[ \t]*[:=][ \t]*"?)/gi

function patternHoldStart(input: string): number {
  let hold = -1
  STREAM_SECRET_START.lastIndex = 0
  for (let match = STREAM_SECRET_START.exec(input); match; match = STREAM_SECRET_START.exec(input)) {
    const tail = input.slice(match.index)
    const possible = /^(?:nvapi-|sk-or-|sk-)[A-Za-z0-9_-]*$/i.test(tail)
      || (/^Bearer[ \t]+/i.test(match[0]) && /^[A-Za-z0-9._-]*$/.test(tail.slice(match[0].length)))
      || (!/^Bearer/i.test(match[0]) && /^[^"\s,}]*$/.test(tail.slice(match[0].length)))
    if (possible) hold = match.index
  }
  return hold
}

export class StreamingRedactor {
  private pending = ''
  private history = new SecretHistory()
  constructor(private source: SecretSource) {}

  private secrets(): string[] {
    return this.history.track(this.source)
  }

  push(chunk: string): string {
    const secrets = this.secrets()
    const combined = this.pending + chunk
    this.pending = ''
    if (!combined) return ''
    const maxLength = secrets.reduce((max, value) => Math.max(max, value.length), 0)
    let hold = 0
    if (maxLength > 1) {
      const limit = Math.min(combined.length, maxLength - 1)
      for (let size = limit; size > 0; size--) {
        const suffix = combined.slice(-size)
        if (secrets.some((value) => value.startsWith(suffix))) {
          hold = size
          break
        }
      }
    }
    const patternStart = patternHoldStart(combined)
    if (patternStart >= 0) {
      const patternLength = combined.length - patternStart
      hold = hold === 0 ? patternLength : Math.min(hold, patternLength)
    }
    const ready = hold ? combined.slice(0, -hold) : combined
    this.pending = hold ? combined.slice(-hold) : ''
    return redactText(ready, secrets)
  }

  flush(): string {
    const pending = this.pending
    this.pending = ''
    return redactText(pending, this.secrets())
  }
}
