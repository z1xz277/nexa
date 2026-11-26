import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseModel } from '../src/renderer/model-selection.ts'
import type { ModelInfo } from '../src/shared/types.ts'

const models: ModelInfo[] = [
  { id: 'a', provider: 'openrouter', name: 'A', context: 1, capabilities: { code: false, reasoning: false, vision: false, tools: true } },
  { id: 'b', provider: 'nvidia', name: 'B', context: 1, capabilities: { code: false, reasoning: false, vision: false, tools: true } }
]

test('a stale selected model is replaced by the project default or first model', () => {
  assert.deepEqual(chooseModel(models, { id: 'removed', provider: 'openrouter' }, 'b'), { id: 'b', provider: 'nvidia' })
  assert.deepEqual(chooseModel(models, { id: 'removed', provider: 'openrouter' }, null), { id: 'a', provider: 'openrouter' })
})

test('an empty catalog clears the selected model', () => {
  assert.equal(chooseModel([], { id: 'a', provider: 'openrouter' }, 'a'), null)
})
