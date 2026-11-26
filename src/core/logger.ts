import type { ActivityEntry } from '@shared/types'
import { uid } from '@shared/types'
import { redactDeep, redactText, type SecretSource } from '@shared/redaction'

export type LogSink = (entry: ActivityEntry) => void

export class ActivityLogger {
  constructor(private sink: LogSink, private secrets: SecretSource = []) {}

  log(sessionId: string, kind: string, summary: string, data?: unknown): ActivityEntry {
    const entry: ActivityEntry = {
      id: uid(),
      ts: Date.now(),
      sessionId,
      kind,
      summary: redactText(summary, typeof this.secrets === 'function' ? this.secrets() : this.secrets),
      data: data === undefined ? undefined : redactDeep(data, this.secrets) as unknown
    }
    this.sink(entry)
    return entry
  }
}

export function filterEntries(entries: ActivityEntry[], query: string): ActivityEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter(
    (e) =>
      e.kind.toLowerCase().includes(q) ||
      e.summary.toLowerCase().includes(q) ||
      JSON.stringify(e.data ?? '').toLowerCase().includes(q)
  )
}