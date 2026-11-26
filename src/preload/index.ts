import { contextBridge, ipcRenderer } from 'electron'
import type { NexaBridge } from '@shared/ipc'
import { CH } from '@shared/ipc'
import type { AgentEvent, ApprovalDecision, ApprovalType, ProviderId, UpdateState } from '@shared/types'

const inv = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const bridge: NexaBridge = {
  window: {
    minimize: () => { ipcRenderer.invoke('window:minimize') },
    maximize: () => { ipcRenderer.invoke('window:maximize') },
    close: () => { ipcRenderer.invoke('window:close') }
  },
  settings: {
    get: inv('settings:get'),
    set: inv('settings:set')
  },
  keys: {
    set: (provider: ProviderId, key: string) => ipcRenderer.invoke('keys:set', provider, key),
    status: inv('keys:status'),
    clear: (provider: ProviderId) => ipcRenderer.invoke('keys:clear', provider)
  },
  models: {
    list: (force?: boolean) => ipcRenderer.invoke('models:list', force),
    cachedAt: inv('models:cachedAt')
  },
  projects: {
    list: inv('projects:list'),
    create: inv('projects:create'),
    update: (id, patch) => ipcRenderer.invoke('projects:update', id, patch),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    pickFolder: inv('projects:pickFolder'),
    memory: (id) => ipcRenderer.invoke('projects:memory', id)
  },
  sessions: {
    list: (projectId) => ipcRenderer.invoke('sessions:list', projectId),
    create: (projectId, title) => ipcRenderer.invoke('sessions:create', projectId, title),
    messages: (sessionId) => ipcRenderer.invoke('sessions:messages', sessionId),
    rename: (id, title) => ipcRenderer.invoke('sessions:rename', id, title),
    remove: (id) => ipcRenderer.invoke('sessions:remove', id)
  },
  fs: {
    tree: (projectId) => ipcRenderer.invoke('fs:tree', projectId),
    read: (projectId, path) => ipcRenderer.invoke('fs:read', projectId, path),
    write: (projectId, path, content) => ipcRenderer.invoke('fs:write', projectId, path, content),
    gitStatus: (projectId) => ipcRenderer.invoke('fs:gitStatus', projectId)
  },
  agent: {
    start: (req) => ipcRenderer.invoke('agent:start', req),
    approve: (id, decision: ApprovalDecision, autoType?: ApprovalType) =>
      ipcRenderer.invoke('agent:approve', id, decision, autoType),
    pause: (sessionId) => ipcRenderer.invoke('agent:pause', sessionId),
    resume: (sessionId) => ipcRenderer.invoke('agent:resume', sessionId),
    stop: (sessionId) => ipcRenderer.invoke('agent:stop', sessionId),
    kill: inv('agent:kill')
  },
  terminal: {
    create: (projectId) => ipcRenderer.invoke('terminal:create', projectId),
    input: (id, data) => ipcRenderer.invoke('terminal:input', id, data),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id)
  },
  checkpoints: {
    list: (sessionId) => ipcRenderer.invoke('checkpoints:list', sessionId),
    restore: (id) => ipcRenderer.invoke('checkpoints:restore', id)
  },
  activity: {
    list: (sessionId, query) => ipcRenderer.invoke('activity:list', sessionId, query),
    export: (sessionId) => ipcRenderer.invoke('activity:export', sessionId)
  },
  updates: {
    status: inv('updates:status'),
    check: inv('updates:check'),
    install: inv('updates:install')
  },
  attach: {
    pick: inv('attach:pick')
  },
  onAgentEvent(cb: (e: AgentEvent) => void) {
    const listener = (_e: Electron.IpcRendererEvent, payload: AgentEvent) => cb(payload)
    ipcRenderer.on(CH.agentEvent, listener)
    return () => ipcRenderer.removeListener(CH.agentEvent, listener)
  },
  onTerminalData(cb: (id: string, data: string) => void) {
    const listener = (_e: Electron.IpcRendererEvent, id: string, data: string) => cb(id, data)
    ipcRenderer.on(CH.terminalData, listener)
    return () => ipcRenderer.removeListener(CH.terminalData, listener)
  },
  onUpdateState(cb: (state: UpdateState) => void) {
    const listener = (_e: Electron.IpcRendererEvent, state: UpdateState) => cb(state)
    ipcRenderer.on(CH.updateState, listener)
    return () => ipcRenderer.removeListener(CH.updateState, listener)
  }
}

contextBridge.exposeInMainWorld('nexa', bridge)