import assert from 'node:assert/strict'
import test from 'node:test'
import { redactDeep, redactText, StreamingRedactor } from '../src/shared/redaction.ts'

test('exact provider values are redacted without relying on a key prefix', () => {
  assert.equal(redactText('value: opaque-provider-credential', ['opaque-provider-credential']), 'value: [REDACTED]')
  assert.equal(redactText('safe text', ['opaque-provider-credential']), 'safe text')
})

test('nested renderer and persisted data is redacted deeply', () => {
  const value = redactDeep({
    content: 'opaque-provider-credential',
    nested: [{ before: 'prefix opaque-provider-credential suffix' }],
    token: 'already-sensitive'
  }, ['opaque-provider-credential'])
  assert.deepEqual(value, {
    content: '[REDACTED]',
    nested: [{ before: 'prefix [REDACTED] suffix' }],
    token: '[REDACTED]'
  })
})

test('streaming redaction catches a secret split across chunks', () => {
  const redactor = new StreamingRedactor(['opaque-provider-credential'])
  const output = redactor.push('before opaque-provider-') + redactor.push('credential after') + redactor.flush()
  assert.equal(output, 'before [REDACTED] after')
})

test('streaming redaction preserves ordinary partial text at end of stream', () => {
  const redactor = new StreamingRedactor(['opaque-provider-credential'])
  assert.equal(redactor.push('ordinary partial op'), 'ordinary partial ')
  assert.equal(redactor.flush(), 'op')
})

test('streaming redaction retains credentials cleared or rotated mid-stream', () => {
  for (const replacement of [[], ['replacement-provider-credential']]) {
    let active: string[] = ['opaque-provider-credential']
    const redactor = new StreamingRedactor(() => active)
    let output = redactor.push('before opaque-provider-')
    active = replacement
    output += redactor.push('credential after') + redactor.flush()
    assert.equal(output, 'before [REDACTED] after')
  }
})

test('streaming redaction catches pattern secrets split across chunks', () => {
  const samples = [
    'nvapi-abcdefghijklmnop',
    'sk-or-abcdefghijklmnop',
    'sk-abcdefghijklmnopqrstuv',
    'Authorization: Bearer abcdefghijklmnop',
    'api_key=abcdefghijklmnop'
  ]
  for (const sample of samples) {
    const redactor = new StreamingRedactor([])
    const split = Math.floor(sample.length / 2)
    const output = redactor.push(`before ${sample.slice(0, split)}`) + redactor.push(`${sample.slice(split)} after`) + redactor.flush()
    assert.equal(output.includes(sample), false, sample)
    assert.match(output, /\[REDACTED\]/, sample)
  }
})
