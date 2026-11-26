import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { Checkpoint } from '@shared/types'
import { isStorageId, storagePath } from './storage-id'

export interface CheckpointCodec {
  isEncryptionAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export interface CheckpointSnapshot {
  path: string
  before: string | null
}

const checkpointSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  ts: z.number().finite(),
  label: z.string(),
  files: z.array(z.object({ path: z.string().min(1), existed: z.boolean() })).max(64)
}).strict()

const legacyCheckpointSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  ts: z.number().finite(),
  label: z.string(),
  files: z.array(z.object({ path: z.string().min(1), before: z.string().nullable() }).strict()).max(64)
}).strict()

const snapshotSchema = z.object({
  version: z.literal(1),
  files: z.array(z.object({ path: z.string().min(1), before: z.string().nullable() })).max(64)
}).strict()

function writeAtomic(file: string, value: Buffer | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, value, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

export class CheckpointVault {
  constructor(private root: string, private codec: CheckpointCodec) {}

  list(): Checkpoint[] {
    let value: unknown
    try {
      value = JSON.parse(fs.readFileSync(path.join(this.root, 'checkpoints.json'), 'utf8'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw new Error('Checkpoint metadata is unavailable.')
    }
    const parsed = z.array(checkpointSchema).safeParse(value)
    if (parsed.success) return parsed.data
    const migrated = this.migrateLegacy(value)
    if (migrated) return migrated
    throw new Error('Checkpoint metadata is invalid.')
  }

  migrate(): void {
    this.list()
  }

  private migrateLegacy(value: unknown): Checkpoint[] | null {
    const parsed = z.array(legacyCheckpointSchema).safeParse(value)
    if (!parsed.success) return null
    if (!this.codec.isEncryptionAvailable()) throw new Error('Checkpoint encryption is unavailable.')
    const checkpoints: Checkpoint[] = []
    const snapshots: { checkpoint: Checkpoint; files: CheckpointSnapshot[] }[] = []
    const ids = new Set<string>()
    for (const legacy of parsed.data) {
      const key = process.platform === 'win32' ? legacy.id.toLowerCase() : legacy.id
      if (!isStorageId(legacy.id) || !isStorageId(legacy.sessionId) || ids.has(key)) {
        throw new Error('Legacy checkpoint metadata is invalid.')
      }
      ids.add(key)
      const checkpoint: Checkpoint = {
        id: legacy.id,
        sessionId: legacy.sessionId,
        ts: legacy.ts,
        label: legacy.label,
        files: legacy.files.map((file) => ({ path: file.path, existed: file.before !== null }))
      }
      checkpoints.push(checkpoint)
      snapshots.push({ checkpoint, files: legacy.files })
    }
    for (const snapshot of snapshots) {
      const encrypted = this.codec.encrypt(JSON.stringify({ version: 1, files: snapshot.files }))
      writeAtomic(storagePath(this.root, 'checkpoint-data', snapshot.checkpoint.id, '.bin'), encrypted)
    }
    writeAtomic(path.join(this.root, 'checkpoints.json'), JSON.stringify(checkpoints, null, 2))
    return checkpoints
  }

  save(checkpoint: Checkpoint, files: CheckpointSnapshot[]): void {
    if (!this.codec.isEncryptionAvailable()) throw new Error('Checkpoint encryption is unavailable.')
    if (!isStorageId(checkpoint.id) || !isStorageId(checkpoint.sessionId)) throw new Error('Invalid checkpoint id.')
    const parsedSnapshot = snapshotSchema.safeParse({ version: 1, files })
    if (!parsedSnapshot.success) throw new Error('Checkpoint snapshot is invalid.')
    const encrypted = this.codec.encrypt(JSON.stringify(parsedSnapshot.data))
    const payload = storagePath(this.root, 'checkpoint-data', checkpoint.id, '.bin')
    writeAtomic(payload, encrypted)
    try {
      const all = this.list().filter((item) => item.id !== checkpoint.id)
      all.push(checkpointSchema.parse(checkpoint))
      writeAtomic(path.join(this.root, 'checkpoints.json'), JSON.stringify(all.slice(-200), null, 2))
    } catch (error) {
      try { fs.rmSync(payload, { force: true }) } catch { /* retain fail-closed metadata */ }
      throw error
    }
  }

  read(id: string): CheckpointSnapshot[] {
    if (!isStorageId(id)) throw new Error('Invalid checkpoint id.')
    const checkpoint = this.list().find((item) => item.id === id)
    if (!checkpoint) throw new Error('Checkpoint snapshot is missing.')
    let encrypted: Buffer
    try {
      encrypted = fs.readFileSync(storagePath(this.root, 'checkpoint-data', id, '.bin'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('Checkpoint snapshot is missing.')
      throw new Error('Checkpoint snapshot is unavailable.')
    }
    let value: unknown
    try {
      value = JSON.parse(this.codec.decrypt(encrypted))
    } catch {
      throw new Error('Checkpoint snapshot could not be decrypted.')
    }
    const parsed = snapshotSchema.safeParse(value)
    if (!parsed.success) throw new Error('Checkpoint snapshot is invalid.')
    const matches = parsed.data.files.length === checkpoint.files.length
      && parsed.data.files.every((file, index) => file.path === checkpoint.files[index].path && (file.before !== null) === checkpoint.files[index].existed)
    if (!matches) throw new Error('Checkpoint snapshot metadata mismatch.')
    return parsed.data.files
  }

  removeSession(sessionId: string): void {
    if (!isStorageId(sessionId)) throw new Error('Invalid session id.')
    const all = this.list()
    const removed = all.filter((item) => item.sessionId === sessionId)
    writeAtomic(path.join(this.root, 'checkpoints.json'), JSON.stringify(all.filter((item) => item.sessionId !== sessionId), null, 2))
    for (const item of removed) fs.rmSync(storagePath(this.root, 'checkpoint-data', item.id, '.bin'), { force: true })
  }
}
