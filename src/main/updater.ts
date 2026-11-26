import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { UpdateState } from '@shared/types'

const execFileAsync = promisify(execFile)

async function registryFeed(): Promise<string | null> {
  for (const hive of ['HKLM', 'HKCU']) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', `${hive}\\Software\\nexa`, '/v', 'UpdateFeedUrl', '/reg:64'], {
        windowsHide: true,
        timeout: 3000
      })
      const match = stdout.match(/UpdateFeedUrl\s+REG_SZ\s+(.+)/i)
      if (match) return match[1].trim()
    } catch { /* try the next registry hive */ }
  }
  return null
}

function validFeed(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))
  } catch {
    return false
  }
}

export class UpdateHost {
  private state: UpdateState = { phase: 'idle', currentVersion: app.getVersion() }
  private started = false

  constructor(private send: (state: UpdateState) => void) {}

  status(): UpdateState {
    return { ...this.state }
  }

  private publish(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.send(this.state)
  }

  start(): void {
    if (this.started) return
    this.started = true
    if (!app.isPackaged || process.platform !== 'win32') {
      this.publish({ phase: 'unsupported', message: 'Automatic updates are available in the installed Windows app.' })
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoRunAppAfterInstall = true
    autoUpdater.allowDowngrade = false
    autoUpdater.disableDifferentialDownload = false

    autoUpdater.on('checking-for-update', () => this.publish({ phase: 'checking', message: undefined }))
    autoUpdater.on('update-not-available', () => this.publish({ phase: 'idle', latestVersion: undefined, message: undefined }))
    autoUpdater.on('update-available', (info) => this.publish({
      phase: 'available', latestVersion: info.version, percent: 0, message: undefined
    }))
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent)
      if (percent === this.state.percent && this.state.phase === 'downloading') return
      this.publish({ phase: 'downloading', percent, message: undefined })
    })
    autoUpdater.on('update-downloaded', (info) => this.publish({
      phase: 'downloaded', latestVersion: info.version, percent: 100, message: undefined
    }))
    autoUpdater.on('error', (error) => this.publish({
      phase: 'error', message: error.message.replace(/https?:\/\/\S+/g, '[update server]').slice(0, 240)
    }))

    void this.configure().catch((error: unknown) => this.publish({
      phase: 'error',
      message: error instanceof Error ? error.message : 'Could not configure automatic updates.'
    }))
    const initial = setTimeout(() => void this.check(), 8000)
    initial.unref()
    const recurring = setInterval(() => void this.check(), 6 * 60 * 60 * 1000)
    recurring.unref()
  }

  private async configure(): Promise<void> {
    const configured = process.env.NEXA_UPDATE_URL ?? await registryFeed()
    if (!configured) throw new Error('Automatic update feed is not configured.')
    if (!validFeed(configured)) {
      throw new Error('The update server must use HTTPS.')
    }
    autoUpdater.setFeedURL({ provider: 'generic', url: configured, channel: 'latest' })
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged || process.platform !== 'win32') {
      this.publish({ phase: 'unsupported', message: 'Automatic updates are available in the installed Windows app.' })
      return this.status()
    }
    if (this.state.phase === 'checking' || this.state.phase === 'downloading') return this.status()
    this.publish({ phase: 'checking', message: undefined })
    try {
      await this.configure()
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.publish({ phase: 'error', message: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[update server]').slice(0, 240) : 'Could not check for updates.' })
    }
    return this.status()
  }

  install(): void {
    if (this.state.phase !== 'downloaded') throw new Error('The update is still being prepared.')
    autoUpdater.quitAndInstall(true, true)
  }
}
