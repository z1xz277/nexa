import type { Checkpoint } from '@shared/types'
import { uid } from '@shared/types'
import type { ToolContext } from '@core/tools'
import { redactDeep, redactText } from '@shared/redaction'
import type { TerminalHost } from './terminal'
import { readProjectDirectory, readProjectFile, readProjectFileSnapshot, requireProjectPath, resolveProjectPath, writeProjectFile } from './project-path'
import { matchesGlob } from './glob'
import { store } from './store'

const IGNORED = new Set(['node_modules', '.git', 'dist', 'out', '.next', 'coverage', '.cache'])
const MAX_FILE = 2 * 1024 * 1024

export interface SandboxDeps {
  projectPath: string | null
  sessionId: string
  terminal: TerminalHost
  agentTermId: () => string | null
  onCheckpoint(cp: Checkpoint): void
}

export function makeToolContext(deps: SandboxDeps): ToolContext {
  const base = deps.projectPath
  const secrets = () => store.secretValues()
  const requireProject = () => {
    if (!base) throw new Error('No project folder is open. Create or open a project first.')
    return base
  }

  const resolve = (rel: string) => resolveProjectPath(base, rel)

  async function walk(base: string, rel: string, out: string[], depth: number): Promise<void> {
    if (depth > 8 || out.length > 6000) return
    let entries
    try { entries = await readProjectDirectory(base, rel || '.') } catch { return }
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.kind === 'dir') await walk(base, r, out, depth + 1)
      else out.push(r)
    }
  }

  return {
    projectPath: base,
    resolve,

    async readFile(rel) {
      return redactText(await readProjectFile(base, rel, MAX_FILE), secrets())
    },

    async readFileRaw(rel) {
      return readProjectFile(base, rel, MAX_FILE)
    },

    async writeFile(rel, content, signal) {
      await writeProjectFile(base, rel, content, signal)
    },

    async listDir(rel) {
      const entries = await readProjectDirectory(base, rel === '.' ? '' : rel)
      return redactDeep(entries
        .filter((e) => e.name !== '.git')
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)), secrets) as { name: string; kind: 'file' | 'dir' }[]
    },

    async search(query, glob) {
      const rootDir = requireProjectPath(base, '.')
      const files: string[] = []
      await walk(rootDir, '', files, 0)
      const hits: { path: string; line: number; text: string }[] = []
      for (const rel of files) {
        if (glob && !matchesGlob(rel, glob)) continue
        if (hits.length >= 200) break
        try {
          const text = await readProjectFile(rootDir, rel, MAX_FILE)
          if (text.includes('\u0000')) continue
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(query)) {
              hits.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) })
              if (hits.length >= 200) break
            }
          }
        } catch { /* unreadable file */ }
      }
      return redactDeep(hits, secrets) as { path: string; line: number; text: string }[]
    },

    async runCommand(command, signal) {
      const rootDir = requireProject()
      return deps.terminal.runCommand(rootDir, command, deps.agentTermId(), signal)
    },

    async readMemory() {
      if (!base) return ''
      try {
        return redactText(await readProjectFile(base, 'PROJECT.md'), secrets())
      } catch {
        return ''
      }
    },

    async checkpoint(paths, signal) {
      signal?.throwIfAborted()
      if (!base) return
      const files: { path: string; before: string | null }[] = []
      for (const rel of paths) {
        signal?.throwIfAborted()
        requireProjectPath(base, rel)
        files.push({ path: rel, before: await readProjectFileSnapshot(base, rel) })
        signal?.throwIfAborted()
      }
      const cp: Checkpoint = {
        id: uid(), sessionId: deps.sessionId, ts: Date.now(), label: paths.join(', '),
        files: files.map((file) => ({ path: file.path, existed: file.before !== null }))
      }
      signal?.throwIfAborted()
      store.addCheckpoint(cp, files)
      deps.onCheckpoint(cp)
    }
  }
}

export async function fileTree(rootDir: string): Promise<import('@shared/types').FileNode[]> {
  async function build(rel: string, depth: number): Promise<import('@shared/types').FileNode[]> {
    if (depth > 6) return []
    let entries
    try { entries = await readProjectDirectory(rootDir, rel || '.') } catch { return [] }
    const nodes: import('@shared/types').FileNode[] = []
    for (const e of entries) {
      if (IGNORED.has(e.name) || e.name === '.git') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.kind === 'dir') {
        nodes.push({ name: e.name, path: r, kind: 'dir', children: await build(r, depth + 1) })
      } else {
        nodes.push({ name: e.name, path: r, kind: 'file' })
      }
    }
    return nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  }
  return build('', 0)
}