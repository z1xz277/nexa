import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { requireProjectPath } from './project-path'
import { safeChildEnvironment } from './terminal'

export async function readGitStatus(cwd: string): Promise<Record<string, string>> {
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const env = {
    ...safeChildEnvironment(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C'
  }
  let root: string
  let gitDir: string
  try {
    root = requireProjectPath(cwd, '.')
    gitDir = requireProjectPath(root, '.git')
    const stat = await fs.lstat(gitDir)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return {}
    requireProjectPath(cwd, '.')
  } catch {
    return {}
  }
  return new Promise((resolve) => {
    execFile('git', [
      `--git-dir=${gitDir}`,
      `--work-tree=${root}`,
      '-c', 'core.fsmonitor=false',
      '-c', `core.hooksPath=${nullDevice}`,
      '--no-optional-locks', 'status', '--porcelain'
    ], { cwd: root, env, timeout: 5000, windowsHide: true }, (err: Error | null, stdout: string) => {
      if (err) { resolve({}); return }
      try { requireProjectPath(cwd, '.') } catch { resolve({}); return }
      const map: Record<string, string> = {}
      for (const line of stdout.split(/\r?\n/)) {
        if (line.length < 4) continue
        const xy = line.slice(0, 2).trim()
        const file = line.slice(3).trim().replace(/^"|"$/g, '')
        const letter = xy.includes('D') ? 'D' : xy.includes('A') || xy.includes('?') ? 'A' : 'M'
        map[file] = letter
      }
      resolve(map)
    })
  })
}
