import fs from 'node:fs/promises'
import { createReadStream, openAsBlob } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const server = (process.env.NEXA_UPDATE_SERVER ?? 'http://127.0.0.1:4318').replace(/\/$/, '')
const token = process.env.NEXA_RELEASE_TOKEN
const channel = process.env.NEXA_RELEASE_CHANNEL ?? 'stable'
if (!token) throw new Error('Set NEXA_RELEASE_TOKEN to the same token used by the update server.')
if (!/^[a-z]+$/.test(channel)) throw new Error('Invalid release channel.')
const endpoint = new URL(server)
const localHttp = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
if ((endpoint.protocol !== 'https:' && !localHttp) || endpoint.username || endpoint.password) {
  throw new Error('The release server must use HTTPS unless it runs on localhost.')
}
const base = `${server}/api/releases/${channel}/${version}`
const auth = { authorization: `Bearer ${token}` }
const artifactDir = path.resolve(process.env.NEXA_ARTIFACT_DIR ?? path.join(root, 'release-candidate'))
const artifact = path.join(artifactDir, `nexa-update-${version}.exe`)
const blockmap = `${artifact}.blockmap`
const builtManifest = path.join(artifactDir, 'latest.yml')

const hashFile = async (file) => {
  const hash = crypto.createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const upload = async (file) => {
  const name = path.basename(file)
  const stat = await fs.stat(file)
  const sha512 = await hashFile(file)
  const blob = await openAsBlob(file, { type: 'application/octet-stream' })
  const res = await fetch(`${base}/${encodeURIComponent(name)}?sha512=${sha512}`, {
    method: 'PUT', headers: { ...auth, 'content-length': String(stat.size) }, body: blob
  })
  if (!res.ok) throw new Error(`Upload failed for ${name}: ${res.status} ${await res.text()}`)
  console.log(`Uploaded ${name} (${(stat.size / 1048576).toFixed(1)} MB)`)
}
await upload(artifact)
try { await upload(blockmap) } catch (error) {
  if (error instanceof Error && error.message.includes('ENOENT')) console.log('No blockmap found, publishing a full-download release.')
  else throw error
}
let manifest = await fs.readFile(builtManifest, 'utf8')
manifest = manifest.replace(/^([ \t]*(?:-[ \t]+)?url:[ \t]*)(?!https?:)(\S+)[ \t]*$/gm, `$1${version}/$2`)
if (/(?:^|\s)url:\s*(?:https?:|\/|\.\.)/m.test(manifest)) throw new Error('Manifest contains an unsafe file URL.')
const res = await fetch(`${base}/manifest`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/yaml' }, body: manifest })
if (!res.ok) throw new Error(`Manifest publish failed: ${res.status} ${await res.text()}`)
console.log(`Published nexa ${version} to ${channel}. Installed apps will receive it automatically.`)
