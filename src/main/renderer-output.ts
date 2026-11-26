import type { AgentEvent } from '@shared/types'
import { redactDeep, SecretHistory, StreamingRedactor, type SecretSource } from '@shared/redaction'

export class RedactingAgentOutput {
  private chunks = new Map<string, { sessionId: string; messageId: string; redactor: StreamingRedactor }>()
  private history = new SecretHistory()

  constructor(private secrets: SecretSource) {}

  private secretValues(): string[] {
    return this.history.track(this.secrets)
  }

  push(event: AgentEvent): AgentEvent[] {
    if (event.type !== 'chunk') {
      if (event.type === 'done' || event.type === 'error' || (event.type === 'status' && event.status === 'idle')) {
        return [...this.flushSession(event.sessionId), redactDeep(event, this.secretValues()) as AgentEvent]
      }
      return [redactDeep(event, this.secretValues()) as AgentEvent]
    }
    const key = `${event.sessionId}:${event.messageId}`
    let stream = this.chunks.get(key)
    if (!stream) {
      stream = { sessionId: event.sessionId, messageId: event.messageId, redactor: new StreamingRedactor(this.secrets) }
      this.chunks.set(key, stream)
    }
    return [{ ...event, text: stream.redactor.push(event.text) }]
  }

  private flushSession(sessionId: string): AgentEvent[] {
    const out: AgentEvent[] = []
    for (const [key, stream] of this.chunks) {
      if (stream.sessionId !== sessionId) continue
      const text = stream.redactor.flush()
      if (text) out.push({ type: 'chunk', sessionId, messageId: stream.messageId, text })
      this.chunks.delete(key)
    }
    return out
  }
}
