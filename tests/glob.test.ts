import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesGlob } from '../src/main/glob.ts'

test('glob matching preserves slash aware star semantics', () => {
  assert.equal(matchesGlob('src/app.ts', '*.ts'), false)
  assert.equal(matchesGlob('src/app.ts', 'src/*.ts'), true)
  assert.equal(matchesGlob('src/nested/app.ts', 'src/**/*.ts'), true)
  assert.equal(matchesGlob('src/app.ts', 'src/**/*.ts'), false)
  assert.equal(matchesGlob('src/APP.ts', 'src/app.ts'), true)
  assert.equal(matchesGlob('src/app.ts', 'src/?pp.ts'), true)
  assert.equal(matchesGlob('src/app.ts', 'src/[a]pp.ts'), false)
})

test('glob matching rejects unbounded patterns without backtracking', () => {
  assert.throws(() => matchesGlob('a'.repeat(4096), '*a'.repeat(300)), /Glob pattern is too long/)
  const started = Date.now()
  assert.equal(matchesGlob(`${'a'.repeat(2000)}b`, `${'*a'.repeat(40)}b`), true)
  assert.ok(Date.now() - started < 1000)
})
