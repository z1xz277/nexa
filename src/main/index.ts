import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AgentEvent, AgentStartRequest, ApprovalDecision, ApprovalRequest,
  Attachment, ChatMessage, ModelInfo, Project, ProviderId, Session
} from '@shared/types'
import { uid } from '@shared/types'
import { redactDeep, redactText } from '@shared/redaction'
import { CH } from '@shared/ipc'
import { AgentLoop } from '@core/agent'
import { FullAccessGrants, isApprovalType } from '@core/access'
import { createTools, ToolRegistry } from '@core/tools'
import { ProviderRegistry } from '@core/providers/registry'
import { ActivityLogger, filterEntries } from '@core/logger'
import { store, newProject } from './store'
import { TerminalHost } from './terminal'
import { fileTree, makeToolContext } from './sandbox'
import { approvalAutoType, createTrustedRunRequest, parseAgentStart, parseApprovalDecision } from './agent-request'
import { confirmFullAccess } from './full-access-confirmation'
import { readProjectFile, requireProjectPath, restoreProjectFiles, writeProjectFile } from './project-path'
import { readGitStatus } from './git-status'
import { UpdateHost } from './updater'
import { RedactingAgentOutput } from './renderer-output'
import { isTrustedIpc, isTrustedRendererUrl, parseProjectPatch } from './ipc-validation'
import { isStorageId } from './storage-id'

let win: BrowserWindow | null = null
const SMOKE = process.argv.includes('--smoke')
const rendererUrl = process.env.ELECTRON_RENDERER_URL || pathToFileURL(path.join(__dirname, '../renderer/index.html')).href

const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}
const updates = new UpdateHost((state) => send(CH.updateState, state))

const terminal = new TerminalHost((id, data) => send(CH.terminalData, id, data), () => store.secretValues())
const logger = new ActivityLogger((entry) => store.appendActivity(entry), () => store.secretValues())
const agentOutput = new RedactingAgentOutput(() => store.secretValues())
const registry = new ProviderRegistry({
  getKey: (p) => store.getKey(p),
  cache: store.modelCache
})
const tools = new ToolRegistry(createTools())

const pendingApprovals = new Map<string, { sessionId: string; type: ApprovalRequest['type']; resolve(d: ApprovalDecision): void }>()
const agentTerms = new Map<string, string>()
const fullAccessGrants = new FullAccessGrants()
const selectedFolders = new Set<string>()

function folderKey(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function requireSession(id: unknown): Session {
  if (!isStorageId(id)) throw new Error('Invalid session id.')
  const session = store.sessions().find((item) => item.id === id)
  if (!session) throw new Error('Session not found.')
  return session
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function rejectPendingApprovals(sessionId: string): void {
  for (const [id, pending] of pendingApprovals) {
    if (pending.sessionId === sessionId) {
      pendingApprovals.delete(id)
      pending.resolve({ action: 'reject' })
    }
  }
}

const agent = new AgentLoop({
  registry,
  tools,
  makeContext(req) {
    const project = store.projects().find((p) => p.id === req.projectId) ?? null
    return makeToolContext({
      projectPath: project?.path ?? null,
      sessionId: req.sessionId,
      terminal,
      agentTermId: () => {
        if (!project?.path) return null
        let id = agentTerms.get(req.sessionId)
        if (!id) {
          id = terminal.create(project.path)
          agentTerms.set(req.sessionId, id)
        }
        return id
      },
      onCheckpoint: (cp) => {
        for (const event of agentOutput.push({ type: 'checkpoint', sessionId: req.sessionId, checkpoint: cp } satisfies AgentEvent)) {
          send(CH.agentEvent, event)
        }
      }
    })
  },
  async systemContext(req) {
    const project = store.projects().find((p) => p.id === req.projectId) ?? null
    let memory = ''
    const pinned: { path: string; content: string }[] = []
    if (project?.path) {
      try { memory = redactText(await readProjectFile(project.path, 'PROJECT.md'), store.secretValues()) } catch { memory = '' }
      for (const rel of project.pinnedFiles.slice(0, 6)) {
        try {
          const content = redactText(await readProjectFile(project.path, rel), store.secretValues())
          pinned.push({ path: rel, content })
        } catch { /* pinned file missing */ }
      }
    }
    return { instructions: project?.instructions ?? '', memory, pinned, projectPath: project?.path ?? null }
  },
  requestApproval(req: ApprovalRequest) {
    return new Promise<ApprovalDecision>((resolve) => {
      pendingApprovals.set(req.id, { sessionId: req.sessionId, type: req.type, resolve })
    })
  },
  log: (sessionId, kind, summary, data) => logger.log(sessionId, kind, summary, data),
  emit: (e) => {
    for (const event of agentOutput.push(e)) send(CH.agentEvent, event)
  },
  persist: (sessionId, message) => store.appendMessage(sessionId, message),
  history: async (sessionId) => store.messages(sessionId)
})

function projectById(id: string | null): Project | null {
  return store.projects().find((p) => p.id === id) ?? null
}

function registerIpc(): void {
  const h = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpc(event, win, rendererUrl)) throw new Error('Untrusted renderer request.')
      return listener(event, ...args)
    })
  }
  const qaFolder = process.env.NEXA_QA_FOLDER
  if (qaFolder) selectedFolders.add(folderKey(requireProjectPath(qaFolder, '.')))

  h('window:minimize', () => win?.minimize())
  h('window:maximize', () => {
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  h('window:close', () => win?.close())

  h('updates:status', () => updates.status())
  h('updates:check', () => updates.check())
  h('updates:install', () => updates.install())

  h('settings:get', () => store.settings())
  h('settings:set', (_e, patch) => store.saveSettings(patch))

  h('keys:set', (_e, provider: ProviderId, key: string) => {
    if (typeof key !== 'string' || key.length > 400) throw new Error('Invalid key.')
    store.setKey(provider, key.trim())
    logger.log('', 'keys', `${provider} key stored (${safeStorage.isEncryptionAvailable() ? 'OS keychain' : 'memory only'})`)
  })
  h('keys:status', () => ({ nvidia: !!store.getKey('nvidia'), openrouter: !!store.getKey('openrouter') }))
  h('keys:clear', (_e, provider: ProviderId) => store.clearKey(provider))

  h('models:list', async (_e, force?: boolean) =>
    redactDeep(await registry.listAll(!!force), () => store.secretValues()) as ModelInfo[])
  h('models:cachedAt', () => {
    const a = store.modelCache.get('nvidia')?.ts ?? 0
    const b = store.modelCache.get('openrouter')?.ts ?? 0
    return Math.max(a, b) || null
  })

  h('projects:list', () => store.projects())
  h('projects:create', async (_e, input: { name: string; path: string | null }) => {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || (input.path !== null && typeof input.path !== 'string')) {
      throw new Error('Invalid project request.')
    }
    let projectPath: string | null = null
    if (input.path !== null) {
      projectPath = requireProjectPath(input.path, '.')
      if (!selectedFolders.delete(folderKey(projectPath))) throw new Error('Choose the project folder through Nexa.')
    }
    const project = newProject({ name: input.name.trim(), path: projectPath })
    if (projectPath) {
      try { await readProjectFile(projectPath, 'PROJECT.md') } catch (error) {
        if (!isMissingPath(error)) throw error
        await writeProjectFile(projectPath, 'PROJECT.md', `# ${project.name}\n\nProject memory for the Nexa agent. Keep durable facts here.\n\n## Stack\n\n## Conventions\n\n## Notes\n`)
      }
    }
    store.saveProjects([...store.projects(), project])
    logger.log('', 'project', `Created project ${project.name}`)
    return redactDeep(project, () => store.secretValues()) as Project
  })
  h('projects:update', (_e, id: string, patch: unknown) => {
    const all = store.projects()
    const idx = all.findIndex((p) => p.id === id)
    if (idx < 0) throw new Error('Project not found.')
    all[idx] = { ...all[idx], ...parseProjectPatch(patch), id }
    store.saveProjects(all)
    return redactDeep(all[idx], () => store.secretValues()) as Project
  })
  h('projects:remove', (_e, id: string) => {
    store.saveProjects(store.projects().filter((p) => p.id !== id))
    const sessions = store.sessions().filter((s) => s.projectId === id)
    for (const s of sessions) store.removeSessionData(s.id)
    store.saveSessions(store.sessions().filter((s) => s.projectId !== id))
  })
  h('projects:pickFolder', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const folder = requireProjectPath(r.filePaths[0], '.')
    selectedFolders.add(folderKey(folder))
    return folder
  })
  h('projects:memory', async (_e, id: string) => {
    const p = projectById(id)
    if (!p?.path) return ''
    try { return redactText(await readProjectFile(p.path, 'PROJECT.md'), store.secretValues()) } catch { return '' }
  })

  h('sessions:list', (_e, projectId: string | null) => {
    if (projectId !== null && !projectById(projectId)) throw new Error('Project not found.')
    return store.sessions().filter((s) => s.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt)
  })
  h('sessions:create', (_e, projectId: string | null, title: string) => {
    if (projectId !== null && !projectById(projectId)) throw new Error('Project not found.')
    if (typeof title !== 'string' || title.length > 80) throw new Error('Invalid session title.')
    const session: Session = { id: uid(), projectId, title: title || 'New session', createdAt: Date.now(), updatedAt: Date.now() }
    store.saveSessions([...store.sessions(), session])
    return redactDeep(session, () => store.secretValues()) as Session
  })
  h('sessions:messages', (_e, sessionId: string) => {
    requireSession(sessionId)
    return store.messages(sessionId)
  })
  h('sessions:rename', (_e, id: string, title: string) => {
    requireSession(id)
    if (typeof title !== 'string' || title.length > 80) throw new Error('Invalid session title.')
    const all = store.sessions()
    const s = all.find((x) => x.id === id)!
    s.title = title
    store.saveSessions(all)
  })
  h('sessions:remove', (_e, id: string) => {
    requireSession(id)
    store.saveSessions(store.sessions().filter((s) => s.id !== id))
    store.removeSessionData(id)
  })

  h('fs:tree', async (_e, projectId: string) => {
    const p = projectById(projectId)
    if (!p?.path) return []
    return redactDeep(await fileTree(p.path), () => store.secretValues())
  })
  h('fs:read', async (_e, projectId: string, rel: string) => {
    const p = projectById(projectId)
    if (!p?.path) throw new Error('Project has no folder.')
    if (typeof rel !== 'string') throw new Error('Invalid file request.')
    return redactText(await readProjectFile(p.path, rel), store.secretValues())
  })
  h('fs:write', async (_e, projectId: string, rel: string, content: string) => {
    const p = projectById(projectId)
    if (!p?.path) throw new Error('Project has no folder.')
    if (typeof rel !== 'string' || typeof content !== 'string') throw new Error('Invalid file request.')
    await writeProjectFile(p.path, rel, content)
    logger.log('', 'file', `Saved ${rel}`)
  })
  h('fs:gitStatus', (_e, projectId: string) => {
    const p = projectById(projectId)
    if (!p?.path) return {}
    return readGitStatus(p.path)
  })

  h('agent:start', async (_e, value: unknown) => {
    const req = redactDeep(parseAgentStart(value), () => store.secretValues()) as AgentStartRequest
    const session = requireSession(req.sessionId)
    let hostConfirmed = false
    if (req.mode === 'full') {
      hostConfirmed = !!win && await confirmFullAccess(() => dialog.showMessageBox(win!, {
        type: 'warning',
        title: 'Confirm Full Access',
        message: 'Allow Full Access for this Nexa run?',
        detail: 'Nexa can edit project files, run commands, use the network, and update project memory without asking for each action. File tools stay inside the project. Shell commands use your Windows account permissions and can reach files or the network outside the project.',
        buttons: ['Enable for this run', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      }))
      if (!hostConfirmed) throw new Error('Full Access was not confirmed.')
    }
    const trusted = createTrustedRunRequest(req, session, fullAccessGrants, hostConfirmed)
    rejectPendingApprovals(req.sessionId)
    return agent.start(trusted)
  })
  h('agent:approve', (_e, id: string, value: unknown, autoType?: string) => {
    if (typeof id !== 'string' || (autoType !== undefined && !isApprovalType(autoType))) {
      throw new Error('Invalid approval request.')
    }
    const decision = parseApprovalDecision(value)
    const pending = pendingApprovals.get(id)
    if (!pending) return
    pendingApprovals.delete(id)
    const grantedType = autoType === undefined ? null : approvalAutoType(decision, pending.type, autoType)
    if (grantedType) agent.autoApprove(id, grantedType)
    pending.resolve(decision)
  })
  h('agent:pause', (_e, sessionId: string) => {
    requireSession(sessionId)
    agent.pause(sessionId)
  })
  h('agent:resume', (_e, sessionId: string) => {
    requireSession(sessionId)
    agent.resume(sessionId)
  })
  h('agent:stop', (_e, sessionId: string) => {
    requireSession(sessionId)
    agent.stop(sessionId)
    const terminalId = agentTerms.get(sessionId)
    if (terminalId) terminal.kill(terminalId)
    agentTerms.delete(sessionId)
    rejectPendingApprovals(sessionId)
  })
  h('agent:kill', () => {
    agent.killAll()
    terminal.killAll()
    fullAccessGrants.revokeAll()
    agentTerms.clear()
    for (const sessionId of new Set([...pendingApprovals.values()].map((pending) => pending.sessionId))) {
      rejectPendingApprovals(sessionId)
    }
    logger.log('', 'kill', 'Kill switch: all runs and terminals stopped')
  })

  h('terminal:create', (_e, projectId: string | null) => {
    const p = projectById(projectId)
    if (!p?.path) throw new Error('Open a project folder before starting a terminal.')
    return terminal.create(requireProjectPath(p.path, '.'))
  })
  h('terminal:input', (_e, id: string, data: string) => {
    if (!isStorageId(id) || typeof data !== 'string' || data.length > 65_536) throw new Error('Invalid terminal input.')
    terminal.input(id, data)
  })
  h('terminal:kill', (_e, id: string) => {
    if (!isStorageId(id)) throw new Error('Invalid terminal id.')
    terminal.kill(id)
  })

  h('checkpoints:list', (_e, sessionId: string) => {
    requireSession(sessionId)
    return store.checkpoints().filter((c) => c.sessionId === sessionId).sort((a, b) => b.ts - a.ts)
  })
  h('checkpoints:restore', async (_e, id: string) => {
    if (!isStorageId(id)) throw new Error('Invalid checkpoint id.')
    const cp = store.checkpoints().find((c) => c.id === id)
    if (!cp) throw new Error('Checkpoint not found.')
    const session = requireSession(cp.sessionId)
    const p = projectById(session.projectId)
    if (!p?.path) throw new Error('Project folder is missing.')
    const files = store.checkpointFiles(cp.id)
    await restoreProjectFiles(p.path, files)
    logger.log(cp.sessionId, 'checkpoint', `Restored checkpoint ${cp.label}`)
  })

  h('activity:list', (_e, sessionId: string | null, query: string) => {
    if (sessionId !== null) requireSession(sessionId)
    if (query !== undefined && typeof query !== 'string') throw new Error('Invalid activity query.')
    return filterEntries(store.activity(sessionId), query ?? '')
  })
  h('activity:export', async (_e, sessionId: string | null) => {
    if (!win) return null
    if (sessionId !== null) requireSession(sessionId)
    const entries = store.activity(sessionId)
    const r = await dialog.showSaveDialog(win, {
      defaultPath: 'nexa-activity.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    await fs.writeFile(r.filePath, JSON.stringify(entries, null, 2), 'utf8')
    return r.filePath
  })

  h('attach:pick', async () => {
    if (!win) return []
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
    if (r.canceled) return []
    const out: Attachment[] = []
    for (const file of r.filePaths.slice(0, 5)) {
      try {
        const stat = await fs.stat(file)
        if (stat.size > 200 * 1024) continue
        out.push({ name: path.basename(file), path: file, content: redactText(await fs.readFile(file, 'utf8'), store.secretValues()) })
      } catch { /* unreadable */ }
    }
    return out
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: store.settings().theme === 'dark' ? '#000000' : '#ffffff',
    title: 'nexa',
    icon: nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', nativeTheme.shouldUseDarkColors ? 'nexa-512.png' : 'nexa-black-512.png')),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guardNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault()
  }
  win.webContents.on('will-navigate', guardNavigation)
  win.webContents.on('will-redirect', guardNavigation)
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(rendererUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  if (SMOKE) {
    win.webContents.once('did-finish-load', () => {
      console.log('NEXA_SMOKE_OK')
      setTimeout(() => app.quit(), 600)
    })
  }
}

Menu.setApplicationMenu(null)

app.setName('nexa')
app.setAppUserModelId('nexa.desktop')
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      const build = Number(os.release().split('.')[2] ?? 0)
      if (build < 22000) {
        dialog.showErrorBox('nexa', 'nexa requires Windows 11 or later.')
        app.quit()
        return
      }
    }
    try {
      store.migrateCheckpoints()
    } catch {
      dialog.showErrorBox('nexa', 'Checkpoint data could not be upgraded. Existing checkpoints were left unchanged.')
    }
    registerIpc()
    createWindow()
    if (!SMOKE) updates.start()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    terminal.killAll()
    if (process.platform !== 'darwin') app.quit()
  })
}