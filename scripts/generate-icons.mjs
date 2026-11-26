import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'assets')
fs.mkdirSync(out, { recursive: true })

const cubic = (from, c1, c2, to, steps = 48) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const u = 1 - t
    return [
      u ** 3 * from[0] + 3 * u ** 2 * t * c1[0] + 3 * u * t ** 2 * c2[0] + t ** 3 * to[0],
      u ** 3 * from[1] + 3 * u ** 2 * t * c1[1] + 3 * u * t ** 2 * c2[1] + t ** 3 * to[1]
    ]
  })
const leaf = [
  ...cubic([236, 768], [236, 506], [414, 326], [768, 236]),
  ...cubic([768, 236], [768, 566], [626, 768], [236, 768]).slice(1)
]
const vein = [[326, 674], [354, 702], [702, 354], [674, 326]]
const polygons = [leaf, vein]
const leafPath = 'M236 768C236 506 414 326 768 236C768 566 626 768 236 768Z'
const veinPath = 'M326 674L354 702L702 354L674 326Z'
const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="${leafPath}${veinPath}" fill-rule="evenodd" fill="${fill}"/></svg>\n`
fs.writeFileSync(path.join(out, 'nexa.svg'), svg('#EAF4FA'))
fs.writeFileSync(path.join(out, 'nexa-black.svg'), svg('#05080A'))

const inside = (x, y) => {
  x *= 1024
  y *= 1024
  let hit = false
  for (const polygon of polygons) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i]
      const [xj, yj] = polygon[j]
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit
    }
  }
  return hit
}

const raster = (size, rgb) => {
  const ss = size >= 512 ? 1 : 4
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    let o = y * (size * 4 + 1)
    raw[o++] = 0
    for (let x = 0; x < size; x++) {
      let covered = 0
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        if (inside((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size)) covered++
      }
      raw[o++] = rgb[0]
      raw[o++] = rgb[1]
      raw[o++] = rgb[2]
      raw[o++] = Math.round(covered / (ss * ss) * 255)
    }
  }
  return raw
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xFFFFFFFF
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
const chunk = (type, data) => {
  const t = Buffer.from(type)
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
const png = (size, rgb) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raster(size, rgb), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const sizes = [16,32,48,64,128,256,512,1024]
const white = sizes.map((s) => [s, png(s, [234,244,250])])
const black512 = png(512, [5,8,10])
white.forEach(([s, data]) => fs.writeFileSync(path.join(out, `nexa-${s}.png`), data))
fs.writeFileSync(path.join(out, 'nexa-512.png'), white.find(([s]) => s === 512)[1])
fs.writeFileSync(path.join(out, 'nexa-black-512.png'), black512)

const icoSizes = [16,32,48,64,128,256]
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4)
let offset = header.length + icoSizes.length * 16
const entries = []
const bodies = []
for (const s of icoSizes) {
  const data = white.find(([n]) => n === s)[1]
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12)
  entries.push(e); bodies.push(data); offset += data.length
}
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...bodies]))

const icnsSizes = [[16,'icp4'],[32,'icp5'],[64,'icp6'],[128,'ic07'],[256,'ic08'],[512,'ic09'],[1024,'ic10']]
const parts = []
for (const [s, type] of icnsSizes) {
  const data = white.find(([n]) => n === s)[1]
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length + 8)
  parts.push(len, Buffer.from(type), data)
}
const total = parts.reduce((n, b) => n + b.length, 0) + 8
const icns = Buffer.alloc(8); icns.write('icns', 0); icns.writeUInt32BE(total, 4)
fs.writeFileSync(path.join(out, 'icon.icns'), Buffer.concat([icns, ...parts]))
console.log('Generated Nexa application icons in assets/.')
