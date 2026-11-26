import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const feedRoot = path.resolve(process.env.NEXA_FEED_DIR ?? path.join(here, '..', 'release-feed'))
const website = path.join(here, 'website')
const token = process.env.NEXA_RELEASE_TOKEN ?? ''
const port = Number(process.env.PORT ?? 4318)
const host = process.env.HOST ?? '0.0.0.0'
const maxUpload = 2 * 1024 * 1024 * 1024
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const filePattern = /^nexa-update-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.exe(?:\.blockmap)?$/
const attempts = new Map()
const channels = new Set(['stable', 'beta', 'alpha'])
const hashFile = async (file) => {
  const hash = crypto.createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

await fsp.mkdir(feedRoot, { recursive: true })

const json = (res, status, value) => {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}
const text = (res, status, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}
const safeJoin = (root, parts) => {
  const target = path.resolve(root, ...parts)
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Invalid path.')
  return target
}
const authorized = (req) => {
  if (!token) return false
  const value = req.headers.authorization ?? ''
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(value)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}
const limited = (req) => {
  const key = req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  const item = attempts.get(key)
  if (!item || item.reset < now) { attempts.set(key, { count: 1, reset: now + 60000 }); return false }
  item.count++
  return item.count > 30
}
const readBody = async (req, limit) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('Request body is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
const readLatest = async (channel = 'stable') => {
  if (!channels.has(channel)) throw new Error('Invalid release channel.')
  const raw = await fsp.readFile(safeJoin(feedRoot, ['nexa', 'win32', channel, 'latest.yml']), 'utf8')
  const version = raw.match(/^version:\s*(\S+)/m)?.[1]
  const pathValue = raw.match(/^path:\s*(\S+)/m)?.[1]
  const sha = raw.match(/^sha512:\s*([a-f0-9]{128})/m)?.[1]
  const files = [...raw.matchAll(/^\s*-?\s*url:\s*(\S+)\s*\n\s*sha512:\s*([a-f0-9]{128})\s*\n\s*size:\s*(\d+)/gm)]
  const exe = files.find((m) => m[1].endsWith('.exe'))
  if (!version || !pathValue || !sha || !exe || exe[2] !== sha) throw new Error('Release manifest is incomplete.')
  return { version, path: pathValue, sha512: sha, url: `/nexa/win32/${channel}/${exe[1]}`, size: Number(exe[3]) }
}
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.yml': 'application/yaml; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8', '.exe': 'application/vnd.microsoft.portable-executable',
  '.blockmap': 'application/octet-stream', '.json': 'application/json; charset=utf-8'
}

async function serveFile(req, res, file) {
  const stat = await fsp.stat(file)
  if (!stat.isFile()) throw new Error('Not a file.')
  const type = contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const cache = /\/(?:latest\.yml|latest\.yaml)$/.test(req.url ?? '') ? 'no-store' : 'public, max-age=31536000, immutable'
  const range = req.headers.range
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }); res.end(); return }
    const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]))
    const end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
    if (start >= stat.size || start > end) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }); res.end(); return }
    res.writeHead(206, {
      'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}`,
      'accept-ranges': 'bytes', 'cache-control': cache
    })
    if (req.method === 'HEAD') { res.end(); return }
    await pipeline(fs.createReadStream(file, { start, end }), res)
    return
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': cache, 'x-content-type-options': 'nosniff' })
  if (req.method === 'HEAD') { res.end(); return }
  await pipeline(fs.createReadStream(file), res)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true })
    if (req.method === 'GET' && url.pathname === '/api/latest') {
      try { return json(res, 200, await readLatest(url.searchParams.get('channel') ?? 'stable')) }
      catch { return json(res, 404, { error: 'No release has been published.' }) }
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const file = await fsp.readFile(path.join(website, 'index.html'))
      res.writeHead(200, { 'content-type': contentTypes['.html'], 'cache-control': 'no-store', 'content-length': file.length })
      return res.end(file)
    }

    const upload = url.pathname.match(/^\/api\/releases\/(stable|beta|alpha)\/([^/]+)\/([^/]+)$/)
    if (upload && req.method === 'PUT' && upload[3] !== 'manifest') {
      if (!authorized(req)) return json(res, 401, { error: 'A valid release token is required.' })
      if (limited(req)) return json(res, 429, { error: 'Too many upload attempts.' })
      const [, channel, version, filename] = upload
      if (!semver.test(version) || !filePattern.test(filename)) return json(res, 400, { error: 'Invalid release name.' })
      const length = Number(req.headers['content-length'] ?? 0)
      if (!Number.isSafeInteger(length) || length < 1 || length > maxUpload) return json(res, 413, { error: 'Invalid upload size.' })
      const digest = String(url.searchParams.get('sha512') ?? '').toLowerCase()
      if (!/^[a-f0-9]{128}$/.test(digest)) return json(res, 400, { error: 'A SHA-512 digest is required.' })
      const dir = safeJoin(feedRoot, ['nexa', 'win32', channel, version])
      await fsp.mkdir(dir, { recursive: true })
      const temp = path.join(dir, `.${filename}.${crypto.randomUUID()}.tmp`)
      const target = path.join(dir, filename)
      const hash = crypto.createHash('sha512')
      const counter = new Transform({
        transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk) }
      })
      try {
        await pipeline(req, counter, fs.createWriteStream(temp, { flags: 'wx' }))
        if (hash.digest('hex') !== digest) throw new Error('Checksum mismatch.')
        await fsp.rename(temp, target)
      } catch (error) {
        await fsp.rm(temp, { force: true }).catch(() => {})
        return json(res, 400, { error: error instanceof Error ? error.message : 'Upload failed.' })
      }
      return json(res, 201, { uploaded: filename, version, channel, size: length, sha512: digest })
    }

    const manifest = url.pathname.match(/^\/api\/releases\/(stable|beta|alpha)\/([^/]+)\/manifest$/)
    if (manifest && req.method === 'PUT') {
      if (!authorized(req)) return json(res, 401, { error: 'A valid release token is required.' })
      if (limited(req)) return json(res, 429, { error: 'Too many upload attempts.' })
      const [, channel, version] = manifest
      if (!semver.test(version)) return json(res, 400, { error: 'Invalid release version.' })
      const raw = (await readBody(req, 128 * 1024)).toString('utf8')
      if (!raw.startsWith(`version: ${version}\n`)) return json(res, 400, { error: 'Manifest version does not match the upload.' })
      const files = [...raw.matchAll(/^\s*-?\s*url:\s*(\S+)\s*\n\s*sha512:\s*([a-f0-9]{128})\s*\n\s*size:\s*(\d+)/gm)]
      if (files.length === 0) return json(res, 400, { error: 'Manifest has no valid files.' })
      const artifact = files.find((m) => m[1].endsWith('.exe'))
      const declaredSha = raw.match(/^sha512:\s*([a-f0-9]{128})/m)?.[1]
      if (!artifact || artifact[2] !== declaredSha) return json(res, 400, { error: 'Manifest checksums do not match.' })
      for (const [, value, sha, size] of files) {
        if (!value.startsWith(`${version}/`) || value.includes('..') || path.isAbsolute(value)) return json(res, 400, { error: 'Manifest URLs must point inside this release.' })
        const file = safeJoin(feedRoot, ['nexa', 'win32', channel, ...value.split('/')])
        const stat = await fsp.stat(file).catch(() => null)
        if (!stat?.isFile()) return json(res, 409, { error: `Upload ${value} before publishing the manifest.` })
        if (stat.size !== Number(size) || await hashFile(file) !== sha) return json(res, 409, { error: `Checksum verification failed for ${value}.` })
      }
      const feedDir = safeJoin(feedRoot, ['nexa', 'win32', channel])
      await fsp.mkdir(feedDir, { recursive: true })
      const temp = path.join(feedDir, `.latest-${crypto.randomUUID()}.tmp`)
      await fsp.writeFile(temp, raw, 'utf8')
      await fsp.rename(temp, path.join(feedDir, 'latest.yml'))
      return json(res, 200, { published: true, version, channel })
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/nexa/win32/')) {
      const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean).slice(2)
      if (parts.length === 0 || parts.some((p) => p === '.' || p === '..' || p.includes('\\'))) return json(res, 400, { error: 'Invalid path.' })
      return await serveFile(req, res, safeJoin(feedRoot, ['nexa', 'win32', ...parts]))
    }
    return json(res, 404, { error: 'Not found.' })
  } catch (error) {
    if (!res.headersSent) json(res, error instanceof Error && error.message === 'Invalid path.' ? 400 : 500, { error: 'Request failed.' })
    else res.destroy()
  }
})

server.requestTimeout = 0
server.headersTimeout = 15_000
server.keepAliveTimeout = 10_000
server.listen(port, host, () => console.log(`nexa update server listening on http://${host}:${port}`))
