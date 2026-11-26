import { useNexa } from '../store'
import { IconActivity, IconCode, IconPause, IconPlay, IconSettings, IconSidebar, IconStop, IconX } from './Icons'

export function TopBar() {
  const s = useNexa()
  const session = s.sessions.find((x) => x.id === s.activeSessionId)
  const running = s.agentStatus === 'running'
  const paused = s.agentStatus === 'paused'

  return (
    <div className="hairline-b flex h-9 shrink-0 items-center gap-4 px-4" style={{ minWidth: 0 }}>
      <button
        type="button"
        className="btn-text shrink-0"
        onClick={s.toggleSidebar}
        title={s.settings.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={s.settings.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!s.settings.sidebarCollapsed}
        aria-controls="sidebar-content"
      >
        <IconSidebar size={13} />
      </button>
      <div className="min-w-0 flex-1 truncate">
        {session ? (
          <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>{session.title}</span>
        ) : (
          <span className="label">New chat</span>
        )}
        {running && <span className="meta ml-3" style={{ color: 'var(--accent)' }}>running</span>}
        {paused && <span className="meta ml-3">paused</span>}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {running && (
          <button className="btn-text flex items-center gap-1.5" onClick={() => void s.pause()}>
            <IconPause size={11} /> Pause
          </button>
        )}
        {paused && (
          <button className="btn-text flex items-center gap-1.5" onClick={() => void s.resume()}>
            <IconPlay size={11} /> Resume
          </button>
        )}
        {(running || paused) && (
          <button className="btn-text flex items-center gap-1.5" onClick={() => void s.stop()}>
            <IconStop size={11} /> Stop
          </button>
        )}
        <button
          className="btn-text flex items-center gap-1.5"
          style={{ color: 'var(--danger)' }}
          onClick={() => void s.kill()}
          title="Stop every run and terminal"
        >
          <IconX size={11} /> Kill
        </button>
        <span className="h-3 w-px" style={{ background: 'var(--hairline-2)' }} />
        <button
          className="btn-text flex items-center gap-1.5"
          style={s.rightOpen ? { color: 'var(--accent)', textDecorationColor: 'var(--accent)' } : undefined}
          onClick={() => s.setRight(!s.rightOpen)}
        >
          <IconCode size={12} /> Code
        </button>
        <button
          className="btn-text flex items-center gap-1.5"
          style={s.activityOpen ? { color: 'var(--accent)', textDecorationColor: 'var(--accent)' } : undefined}
          onClick={() => s.setActivity(!s.activityOpen)}
        >
          <IconActivity size={12} /> Activity
        </button>
        <button className="btn-text flex items-center gap-1.5" onClick={() => s.setSettings(true)}>
          <IconSettings size={12} /> Settings
        </button>
      </div>
    </div>
  )
}