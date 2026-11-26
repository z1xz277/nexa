import test from 'node:test'
import assert from 'node:assert/strict'
import * as labels from '../src/renderer/lib/model-label'
import { displayModelLabel } from '../src/renderer/lib/model-label'

test('model labels remove prohibited provider wording without losing identity', () => {
  assert.equal(displayModelLabel('Baidu: ERNIE-5.5-Flash-Preview (free)'), 'Baidu: ERNIE-5.5-Flash-Preview')
  assert.equal(displayModelLabel('Free Models Router'), 'Models Router')
  assert.equal(displayModelLabel('vendor/model:free'), 'vendor/model')
  assert.equal(displayModelLabel('Gemma 4 (FREE)'), 'Gemma 4')
})

test('context labels format known sizes without showing unavailable metadata', () => {
  assert.equal(typeof labels.displayContextLabel, 'function')
  assert.equal(labels.displayContextLabel(131072), '131k context')
  assert.equal(labels.displayContextLabel(1000000), '1M context')
  assert.equal(labels.displayContextLabel(0), 'Tool-capable model')
  assert.equal(labels.displayContextLabel(Number.NaN), 'Tool-capable model')
})

test('model labels normalize dashes and empty pricing suffixes', () => {
  assert.equal(displayModelLabel('Example — Preview (free)'), 'Example - Preview')
  assert.equal(displayModelLabel('Example: free'), 'Example')
  assert.equal(displayModelLabel('(free)'), 'Model')
})
