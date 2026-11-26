import assert from 'node:assert/strict'
import test from 'node:test'
import { confirmFullAccess } from '../src/main/full-access-confirmation.ts'

test('Full Access requires the host approval response', async () => {
  assert.equal(await confirmFullAccess(async () => ({ response: 0, checkboxChecked: false })), true)
})

test('dismissing the host dialog denies Full Access', async () => {
  assert.equal(await confirmFullAccess(async () => ({ response: 1, checkboxChecked: false })), false)
})

test('an unavailable host dialog fails closed', async () => {
  assert.equal(await confirmFullAccess(async () => { throw new Error('dialog unavailable') }), false)
})
