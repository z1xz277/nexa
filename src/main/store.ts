import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ActivityEntry, ChatMessage, Checkpoint, ModelInfo, Project, ProviderId,
  Session, Settings
} from '@shared/types'
import { DEFAULT_SETTINGS, uid } from '@shared/types'
import { redactDeep, SecretHistory } from '@shared/redaction'
import { CheckpointVault, type CheckpointSnapshot } from './checkpoint-vault'
import { storagePath } from './storage-id'

const localEnv = path.join(app.getAppPath(), '.env.local')
const localKeys: Partial<Record<ProviderId, string>> = {}
const keyEnvNames: Record<ProviderId, string> = {
  openrouter: 'NEXA_OPENROUTER_KEY',
  nvidia: 'NEXA_NVIDIA_KEY'
}
const secretHistory = new SecretHistory()
if (fs.existsSync(localEnv)) process.loadEnvFile(localEnv)
for (const provider of Object.keys(keyEnvNames) as ProviderId[]) {
  const value = process.env[keyEnvNames[provider]]?.trim()
  if (value) {
    localKeys[provider] = value
    secretHistory.track([value])
  }
  delete process.env[keyEnvNames[provider]]
}

const root = () => {
  const dir = path.join(app.getPath('userData'), 'nexa-data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const checkpointVault = new CheckpointVault(root(), {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value)
})

function readJson<T>(file: string, fallback: T): T {
  try {
    const target = path.isAbsolute(file) ? file : path.join(root(), file)
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  const target = path.isAbsolute(file) ? file : path.join(root(), file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, target)
}

export const store = {
  settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>('settings.json', {}) }
  },
  saveSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings(), ...patch }
    writeJson('settings.json', next)
    return next
  },

  projects(): Project[] {
    return redactDeep(readJson<Project[]>('projects.json', []), () => this.secretValues()) as Project[]
  },
  saveProjects(projects: Project[]): void {
    writeJson('projects.json', redactDeep(projects, () => this.secretValues()))
  },

  sessions(): Session[] {
    return redactDeep(readJson<Session[]>('sessions.json', []), () => this.secretValues()) as Session[]
  },
  saveSessions(sessions: Session[]): void {
    writeJson('sessions.json', redactDeep(sessions, () => this.secretValues()))
  },

  messages(sessionId: string): ChatMessage[] {
    return redactDeep(readJson<ChatMessage[]>(storagePath(root(), 'messages', sessionId, '.json'), []), () => this.secretValues()) as ChatMessage[]
  },
  appendMessage(sessionId: string, message: ChatMessage): void {
    const safeMessage = redactDeep(message, () => this.secretValues()) as ChatMessage
    const all = this.messages(sessionId)
    all.push(safeMessage)
    writeJson(storagePath(root(), 'messages', sessionId, '.json'), all)
    const sessions = this.sessions()
    const s = sessions.find((x) => x.id === sessionId)
    if (s) {
      s.updatedAt = Date.now()
      if (s.title === 'New session' && message.role === 'user') {
        s.title = safeMessage.content.slice(0, 60) || 'New session'
      }
      this.saveSessions(sessions)
    }
  },

  // Keys are encrypted with the OS credential store (DPAPI, Keychain, libsecret).
  // If encryption is unavailable they live in memory only, never on disk.
  memoryKeys: new Map<ProviderId, string>(),
  setKey(provider: ProviderId, key: string): void {
    delete localKeys[provider]
    secretHistory.track([key])
    if (safeStorage.isEncryptionAvailable()) {
      const keys = readJson<Record<string, string>>('keys.enc', {})
      keys[provider] = safeStorage.encryptString(key).toString('base64')
      writeJson('keys.enc', keys)
    } else {
      this.memoryKeys.set(provider, key)
    }
    this.modelCache.delete(provider)
  },
  getKey(provider: ProviderId): string | null {
    if (localKeys[provider]) return localKeys[provider]
    if (this.memoryKeys.has(provider)) return this.memoryKeys.get(provider)!
    const keys = readJson<Record<string, string>>('keys.enc', {})
    const enc = keys[provider]
    if (!enc) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  },
  secretValues(): string[] {
    const active = (Object.keys(keyEnvNames) as ProviderId[])
      .map((provider) => this.getKey(provider))
      .filter((value): value is string => !!value)
    return secretHistory.track(active)
  },
  clearKey(provider: ProviderId): void {
    delete localKeys[provider]
    this.memoryKeys.delete(provider)
    const keys = readJson<Record<string, string>>('keys.enc', {})
    delete keys[provider]
    writeJson('keys.enc', keys)
    this.modelCache.delete(provider)
  },

  modelCache: {
    get(provider: ProviderId): { ts: number; models: ModelInfo[] } | null {
      const all = readJson<Record<string, { ts: number; models: ModelInfo[] }>>('model-cache.json', {})
      return all[provider] ?? null
    },
    set(provider: ProviderId, models: ModelInfo[]): void {
      const all = readJson<Record<string, { ts: number; models: ModelInfo[] }>>('model-cache.json', {})
      all[provider] = { ts: Date.now(), models }
      writeJson('model-cache.json', all)
    },
    delete(provider: ProviderId): void {
      const all = readJson<Record<string, { ts: number; models: ModelInfo[] }>>('model-cache.json', {})
      if (!all[provider]) return
      delete all[provider]
      writeJson('model-cache.json', all)
    }
  },

  appendActivity(entry: ActivityEntry): void {
    const file = storagePath(root(), 'activity', entry.sessionId || 'global', '.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(redactDeep(entry, () => this.secretValues())) + '\n', 'utf8')
  },
  activity(sessionId: string | null): ActivityEntry[] {
    const dir = path.join(root(), 'activity')
    if (!fs.existsSync(dir)) return []
    const files = sessionId ? [path.basename(storagePath(root(), 'activity', sessionId, '.jsonl'))] : fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    const out: ActivityEntry[] = []
    for (const f of files) {
      if (!/^[A-Za-z0-9_-]+\.jsonl$/.test(f)) continue
      try {
        const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)
        for (const l of lines) out.push(JSON.parse(l))
      } catch { /* skip corrupt line files */ }
    }
    return redactDeep(out.sort((a, b) => b.ts - a.ts).slice(0, 2000), () => this.secretValues()) as ActivityEntry[]
  },

  checkpoints(): Checkpoint[] {
    return redactDeep(checkpointVault.list(), () => this.secretValues()) as Checkpoint[]
  },
  migrateCheckpoints(): void {
    checkpointVault.migrate()
  },
  addCheckpoint(cp: Checkpoint, files: CheckpointSnapshot[]): void {
    checkpointVault.save(cp, files)
  },
  checkpointFiles(id: string): CheckpointSnapshot[] {
    return checkpointVault.read(id)
  },
  removeSessionData(sessionId: string): void {
    try { fs.rmSync(storagePath(root(), 'messages', sessionId, '.json')) } catch { /* absent */ }
    try { fs.rmSync(storagePath(root(), 'activity', sessionId, '.jsonl')) } catch { /* absent */ }
    checkpointVault.removeSession(sessionId)
  }
}

export function newProject(input: { name: string; path: string | null }): Project {
  const project: Project = {
    id: uid(),
    name: input.name,
    path: input.path,
    instructions: '',
    defaultModel: null,
    defaultEffort: 'medium',
    pinnedFiles: [],
    createdAt: Date.now()
  }
  return project
}