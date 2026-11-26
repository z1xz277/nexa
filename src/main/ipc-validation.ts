import { z } from 'zod'
import type { Project } from '@shared/types'

const relativePath = z.string().min(1).max(1000).refine((value) => {
  const normalized = value.replace(/\\/g, '/')
  return !normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized) && !normalized.split('/').includes('..')
}, 'Invalid project path.')

const projectPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  instructions: z.string().max(20_000).optional(),
  defaultModel: z.string().max(240).nullable().optional(),
  defaultEffort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  pinnedFiles: z.array(relativePath).max(32).optional()
}).strict()

export type ProjectPatch = Partial<Pick<Project, 'name' | 'instructions' | 'defaultModel' | 'defaultEffort' | 'pinnedFiles'>>

export function parseProjectPatch(value: unknown): ProjectPatch {
  const parsed = projectPatchSchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid project update.')
  return parsed.data
}

interface IpcFrame {
  url?: string
}

interface IpcSender {
  id: number
  mainFrame: IpcFrame
}

interface IpcEventLike {
  sender: IpcSender
  senderFrame: IpcFrame | null
}

interface WindowLike {
  webContents: IpcSender
}

export function isTrustedRendererUrl(value: string, rendererUrl: string): boolean {
  try {
    const actual = new URL(value)
    const expected = new URL(rendererUrl)
    if (expected.protocol === 'file:') return actual.protocol === 'file:' && actual.href === expected.href
    return actual.origin === expected.origin
  } catch {
    return false
  }
}

export function isTrustedIpc(event: IpcEventLike, window: WindowLike | null, rendererUrl: string): boolean {
  return !!window &&
    event.sender.id === window.webContents.id &&
    event.senderFrame === window.webContents.mainFrame &&
    typeof event.senderFrame?.url === 'string' &&
    isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
}
