import type { NexaBridge } from '@shared/ipc'
import { createMockBridge } from './mock'
import { isBrowserPreview } from './bridge-mode'

declare global {
  interface Window {
    nexa?: NexaBridge
  }
}

export const isDesktop = typeof window !== 'undefined' && !!window.nexa
const preview = typeof window !== 'undefined' && isBrowserPreview({
  dev: import.meta.env.DEV,
  hostname: window.location.hostname,
  port: window.location.port
})

function unavailable(): never {
  throw new Error('The Nexa desktop host is unavailable. Open Nexa in the desktop app.')
}

const unavailableBridge: NexaBridge = {
  window: { minimize: unavailable, maximize: unavailable, close: unavailable },
  settings: { get: unavailable, set: unavailable },
  keys: { set: unavailable, status: unavailable, clear: unavailable },
  models: { list: unavailable, cachedAt: unavailable },
  projects: {
    list: unavailable, create: unavailable, update: unavailable,
    remove: unavailable, pickFolder: unavailable, memory: unavailable
  },
  sessions: {
    list: unavailable, create: unavailable, messages: unavailable,
    rename: unavailable, remove: unavailable
  },
  fs: { tree: unavailable, read: unavailable, write: unavailable, gitStatus: unavailable },
  agent: {
    start: unavailable, approve: unavailable,
    pause: unavailable, resume: unavailable, stop: unavailable, kill: unavailable
  },
  terminal: { create: unavailable, input: unavailable, kill: unavailable },
  checkpoints: { list: unavailable, restore: unavailable },
  activity: { list: unavailable, export: unavailable },
  updates: { status: unavailable, check: unavailable, install: unavailable },
  attach: { pick: unavailable },
  onAgentEvent: () => () => {},
  onTerminalData: () => () => {},
  onUpdateState: () => () => {}
}

export const bridge: NexaBridge = isDesktop ? window.nexa! : preview ? createMockBridge() : unavailableBridge