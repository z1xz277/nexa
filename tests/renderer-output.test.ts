import assert from 'node:assert/strict'
import test from 'node:test'
import { RedactingAgentOutput } from '../src/main/renderer-output.ts'
import type { AgentEvent } from '../src/shared/types.ts'

test('agent chunk events cannot reveal a secret split across events', () => {
  const output = new RedactingAgentOutput(['opaque-provider-credential'])
  const events: AgentEvent[] = []
  events.push(...output.push({ type: 'chunk', sessionId: 's1', messageId: 'm1', text: 'before opaque-provider-' }))
  events.push(...output.push({ type: 'chunk', sessionId: 's1', messageId: 'm1', text: 'credential after' }))
  events.push(...output.push({ type: 'done', sessionId: 's1', usage: { tokens: 1, ms: 1 } }))
  assert.equal(events.map((event) => event.type === 'chunk' ? event.text : '').join(''), 'before [REDACTED] after')
})

test('agent messages and tool results are redacted before reaching the renderer', () => {
  const output = new RedactingAgentOutput(['opaque-provider-credential'])
  const [event] = output.push({
    type: 'message', sessionId: 's1',
    message: { id: 'm1', role: 'assistant', content: 'opaque-provider-credential', createdAt: 1 }
  })
  assert.equal(event.type, 'message')
  if (event.type === 'message') assert.equal(event.message.content, '[REDACTED]')
})

test('approval arguments and diffs are redacted before reaching the renderer', () => {
  const output = new RedactingAgentOutput(['opaque-provider-credential'])
  const [event] = output.push({
    type: 'approval', sessionId: 's1',
    request: {
      id: 'a1', sessionId: 's1', type: 'write', toolName: 'write_file', title: 'Write config.txt',
      path: 'config.txt', args: { path: 'config.txt', content: 'opaque-provider-credential' },
      diff: { before: '', after: 'opaque-provider-credential' }
    }
  })
  assert.equal(event.type, 'approval')
  if (event.type === 'approval') {
    assert.equal(event.request.args.content, '[REDACTED]')
    assert.equal(event.request.diff?.after, '[REDACTED]')
  }
})

test('agent output retains credentials cleared or rotated between events', () => {
  for (const replacement of [[], ['replacement-provider-credential']]) {
    let active = ['opaque-provider-credential']
    const output = new RedactingAgentOutput(() => active)
    output.push({
      type: 'message', sessionId: 's1',
      message: { id: 'm1', role: 'assistant', content: 'opaque-provider-credential', createdAt: 1 }
    })
    active = replacement
    const [event] = output.push({
      type: 'message', sessionId: 's1',
      message: { id: 'm2', role: 'assistant', content: 'opaque-provider-credential', createdAt: 2 }
    })
    assert.equal(event.type, 'message')
    if (event.type === 'message') assert.equal(event.message.content, '[REDACTED]')
  }
})
