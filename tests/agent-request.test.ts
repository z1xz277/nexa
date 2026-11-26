import assert from 'node:assert/strict'
import test from 'node:test'
import { FullAccessGrants } from '../src/core/access.ts'
import { approvalAutoType, createTrustedRunRequest, parseAgentStart, parseApprovalDecision } from '../src/main/agent-request.ts'
import type { AgentStartRequest, Session } from '../src/shared/types.ts'

const session: Session = { id: 'session-1', projectId: 'project-1', title: 'Test', createdAt: 1, updatedAt: 1 }
const request: AgentStartRequest = {
  sessionId: session.id,
  projectId: session.projectId,
  prompt: 'Inspect the project.',
  model: { id: 'test/model', provider: 'openrouter' },
  effort: 'medium',
  mode: 'agent',
  attachments: []
}

test('the host derives the run project from the stored session', () => {
  const trusted = createTrustedRunRequest(
    { ...request, projectId: 'renderer-supplied-project' },
    session,
    new FullAccessGrants()
  )
  assert.equal(trusted.projectId, 'project-1')
  assert.deepEqual(trusted.access, { mode: 'agent', fullAccess: false, autoApprove: [] })
})

test('Full Access fails closed without host confirmation', () => {
  assert.throws(
    () => createTrustedRunRequest({ ...request, mode: 'full' }, session, new FullAccessGrants()),
    /host confirmation/i
  )
})

test('host confirmation enables Full Access for exactly one run', () => {
  const grants = new FullAccessGrants()
  const trusted = createTrustedRunRequest(
    { ...request, mode: 'full' },
    session,
    grants,
    true
  )
  assert.equal(trusted.access.mode, 'full')
  assert.equal(trusted.access.fullAccess, true)
  assert.throws(
    () => createTrustedRunRequest({ ...request, mode: 'full' }, session, grants),
    /host confirmation/i
  )
})

test('a renderer cannot supply its own Full Access token', () => {
  assert.throws(
    () => parseAgentStart({ ...request, mode: 'full', fullAccessToken: 'renderer-token' }),
    /Invalid agent request/i
  )
})

test('an extra token does not elevate Ask mode', () => {
  assert.throws(
    () => parseAgentStart({ ...request, mode: 'ask', fullAccessToken: 'renderer-token' }),
    /Invalid agent request/i
  )
})

test('renderer requests are validated before reaching the agent', () => {
  assert.throws(() => parseAgentStart({ ...request, mode: 'full-access' }), /Invalid agent request/i)
  assert.throws(() => parseAgentStart({ ...request, effort: 'extreme' }), /Invalid agent request/i)
  assert.throws(() => parseAgentStart({ ...request, prompt: '' }), /Invalid agent request/i)
  assert.throws(() => parseAgentStart({ ...request, attachments: [{ name: 'x', path: 'x', content: 'x' }, ...Array.from({ length: 5 }, () => ({ name: 'x', path: 'x', content: 'x' }))] }), /Invalid agent request/i)
})

test('approval decisions are validated at the host boundary', () => {
  assert.deepEqual(parseApprovalDecision({ action: 'approve' }), { action: 'approve' })
  assert.deepEqual(parseApprovalDecision({ action: 'edit', args: { path: 'safe.txt' } }), { action: 'edit', args: { path: 'safe.txt' } })
  assert.throws(() => parseApprovalDecision({ action: 'allow-all' }), /Invalid approval decision/i)
  assert.throws(() => parseApprovalDecision({ action: 'edit', args: '../outside.txt' }), /Invalid approval decision/i)
})

test('automatic approval is bound to an approved pending request of the same type', () => {
  assert.equal(approvalAutoType({ action: 'approve' }, 'write', 'write'), 'write')
  assert.equal(approvalAutoType({ action: 'edit', args: {} }, 'edit', 'edit'), 'edit')
  assert.equal(approvalAutoType({ action: 'reject' }, 'write', 'write'), null)
  assert.equal(approvalAutoType({ action: 'approve' }, 'write', 'command'), null)
  assert.equal(approvalAutoType({ action: 'approve' }, 'write', 'invalid'), null)
})
