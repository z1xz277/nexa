// Topographic contour hero: 3D simplex noise sampled on a grid, iso-lines
// extracted with marching squares, drifting slowly through the noise z axis.

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
]

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Simplex3 {
  private perm = new Uint8Array(512)
  constructor(seed = 1337) {
    const rand = mulberry32(seed)
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const t = p[i]; p[i] = p[j]; p[j] = t
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]
  }

  noise(xin: number, yin: number, zin: number): number {
    const F3 = 1 / 3, G3 = 1 / 6
    const perm = this.perm
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s)
    const t = (i + j + k) * G3
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t)
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3
    const ii = i & 255, jj = j & 255, kk = k & 255
    let n = 0
    const corner = (x: number, y: number, z: number, gi: number) => {
      let tt = 0.6 - x * x - y * y - z * z
      if (tt < 0) return 0
      tt *= tt
      const g = GRAD3[gi % 12]
      return tt * tt * (g[0] * x + g[1] * y + g[2] * z)
    }
    n += corner(x0, y0, z0, perm[ii + perm[jj + perm[kk]]])
    n += corner(x1, y1, z1, perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]])
    n += corner(x2, y2, z2, perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]])
    n += corner(x3, y3, z3, perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]])
    return 32 * n
  }
}

// Marching squares edge pairs per case index (tl=1, tr=2, br=4, bl=8).
// Edges: 0 top, 1 right, 2 bottom, 3 left. Cases 5 and 10 are resolved by center.
const CASES: number[][][] = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [], [[0, 2]], [[3, 2]],
  [[2, 3]], [[0, 2]], [], [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], []
]

export interface ContourOptions {
  rgb: string
  opacity: number
  cell?: number
  speed?: number
  levels?: number[]
}

export class ContourHero {
  private ctx: CanvasRenderingContext2D | null
  private noise = new Simplex3(20261125)
  private raf = 0
  private running = false
  private z = 0
  private last = 0
  private w = 0
  private h = 0
  private dpr = 1
  private opts: Required<ContourOptions>
  private onVisibility = () => {
    if (document.hidden) this.cancel()
    else if (this.running) this.loop()
  }

  constructor(private canvas: HTMLCanvasElement, options: ContourOptions) {
    this.ctx = canvas.getContext('2d')
    this.opts = {
      cell: 16,
      speed: 0.000045,
      levels: [-0.58, -0.3, -0.02, 0.26, 0.54],
      ...options
    }
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  resize(w: number, h: number): void {
    this.w = w
    this.h = h
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr))
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr))
    if (!this.running) this.renderStatic()
  }

  setTheme(rgb: string): void {
    this.opts.rgb = rgb
    if (!this.running) this.renderStatic()
  }

  start(): void {
    if (!this.ctx || this.running) return
    this.running = true
    this.last = performance.now()
    this.loop()
  }

  stop(): void {
    this.running = false
    this.cancel()
  }

  destroy(): void {
    this.stop()
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  renderStatic(): void {
    this.draw()
  }

  private cancel(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private loop = (): void => {
    if (!this.running || document.hidden) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    // Cap at ~30fps: the drift is slow, extra frames buy nothing.
    if (now - this.last < 33) return
    this.z += (now - this.last) * this.opts.speed
    this.last = now
    this.draw()
  }

  private draw(): void {
    const ctx = this.ctx
    if (!ctx || this.w === 0 || this.h === 0) return
    const { cell, levels, rgb, opacity } = this.opts
    const cols = Math.ceil(this.w / cell) + 1
    const rows = Math.ceil(this.h / cell) + 1
    const scale = 0.0042
    const field = new Float32Array(cols * rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        field[y * cols + x] = this.noise.noise(x * cell * scale, y * cell * scale, this.z)
      }
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    ctx.lineWidth = 1
    ctx.lineCap = 'round'

    for (let li = 0; li < levels.length; li++) {
      const level = levels[li]
      // Deeper contours read slightly fainter, like elevation ink.
      ctx.strokeStyle = `rgba(${rgb},${(opacity * (0.72 + 0.28 * (li / (levels.length - 1)))).toFixed(3)})`
      ctx.beginPath()
      for (let y = 0; y < rows - 1; y++) {
        for (let x = 0; x < cols - 1; x++) {
          const tl = field[y * cols + x]
          const tr = field[y * cols + x + 1]
          const br = field[(y + 1) * cols + x + 1]
          const bl = field[(y + 1) * cols + x]
          let idx = (tl > level ? 1 : 0) | (tr > level ? 2 : 0) | (br > level ? 4 : 0) | (bl > level ? 8 : 0)
          if (idx === 0 || idx === 15) continue
          if (idx === 5 || idx === 10) {
            const center = (tl + tr + br + bl) / 4
            if (idx === 5) idx = center > level ? 51 : 52
            else idx = center > level ? 101 : 102
          }
          const px = x * cell, py = y * cell
          const edge = (e: number): [number, number] => {
            switch (e) {
              case 0: return [px + cell * lerp(tl, tr, level), py]
              case 1: return [px + cell, py + cell * lerp(tr, br, level)]
              case 2: return [px + cell * lerp(bl, br, level), py + cell]
              default: return [px, py + cell * lerp(tl, bl, level)]
            }
          }
          const segs = idx === 51 ? [[3, 2], [0, 1]] : idx === 52 ? [[3, 0], [1, 2]]
            : idx === 101 ? [[0, 1], [2, 3]] : idx === 102 ? [[3, 0], [1, 2]]
            : CASES[idx]
          for (const [a, b] of segs) {
            const p1 = edge(a), p2 = edge(b)
            ctx.moveTo(p1[0], p1[1])
            ctx.lineTo(p2[0], p2[1])
          }
        }
      }
      ctx.stroke()
    }
  }
}

function lerp(a: number, b: number, level: number): number {
  const d = b - a
  if (Math.abs(d) < 1e-9) return 0.5
  return Math.min(1, Math.max(0, (level - a) / d))
}