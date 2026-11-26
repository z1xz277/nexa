import assert from 'node:assert/strict'
import test from 'node:test'
import { FullAccessGrants, parseRunAccess } from '../src/core/access.ts'

test('a Full Access grant is bound, expiring, and single use', () => {
  let now = 1_000
  const grants = new FullAccessGrants({ now: () => now, ttlMs: 100 })
  const grant = grants.issue('session-1', 'project-1')
  assert.equal(grant.expiresAt, 1_100)
  assert.deepEqual(grants.consume(grant.token, 'session-1', 'project-1'), {
    mode: 'full',
    fullAccess: true,
    autoApprove: ['write', 'edit', 'command', 'network', 'memory']
  })
  assert.throws(() => grants.consume(grant.token, 'session-1', 'project-1'), /invalid or expired/i)
})

test('a Full Access grant cannot be used by another session', () => {
  const grants = new FullAccessGrants()
  const grant = grants.issue('session-1', 'project-1')
  assert.throws(() => grants.consume(grant.token, 'session-2', 'project-1'), /invalid or expired/i)
})

test('a Full Access grant cannot be used for another project', () => {
  const grants = new FullAccessGrants()
  const grant = grants.issue('session-1', 'project-1')
  assert.throws(() => grants.consume(grant.token, 'session-1', 'project-2'), /invalid or expired/i)
})

test('an expired Full Access grant fails closed', () => {
  let now = 1_000
  const grants = new FullAccessGrants({ now: () => now, ttlMs: 100 })
  const grant = grants.issue('session-1', 'project-1')
  now = 1_101
  assert.throws(() => grants.consume(grant.token, 'session-1', 'project-1'), /invalid or expired/i)
})

test('Kill revokes every unconsumed Full Access grant', () => {
  const grants = new FullAccessGrants()
  const first = grants.issue('session-1', 'project-1')
  const second = grants.issue('session-2', 'project-2')
  grants.revokeAll()
  assert.throws(() => grants.consume(first.token, 'session-1', 'project-1'), /invalid or expired/i)
  assert.throws(() => grants.consume(second.token, 'session-2', 'project-2'), /invalid or expired/i)
})

test('run access rejects forged or inconsistent capabilities', () => {
  assert.throws(() => parseRunAccess({ mode: 'full', fullAccess: false, autoApprove: [] }), /Full Access/i)
  assert.throws(() => parseRunAccess({ mode: 'ask', fullAccess: false, autoApprove: ['write'] }), /Ask/i)
  assert.throws(() => parseRunAccess({ mode: 'agent', fullAccess: true, autoApprove: [] }), /Full Access/i)
  assert.throws(() => parseRunAccess({ mode: 'agent', fullAccess: false, autoApprove: ['everything'] }), /approval/i)
})
