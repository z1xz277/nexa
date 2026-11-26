import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('release publishing rejects insecure remote servers before reading artifacts', (t) => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-release-publish-'))
  t.after(() => fs.rmSync(artifacts, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, ['scripts/publish-update.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      NEXA_UPDATE_SERVER: 'http://192.0.2.1',
      NEXA_RELEASE_TOKEN: 'test-token',
      NEXA_ARTIFACT_DIR: artifacts
    },
    encoding: 'utf8',
    timeout: 10000
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HTTPS|localhost/i)
})
