import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNexa } from '../store'
import { bridge } from '../bridge'
import { SPRING, SPRING_SOFT } from '../motion'
import { IconFolder, IconPlus, IconX } from './Icons'

function relTime(ts: number): string {
  const d = Date.now() - ts
  if (d < 60000) return 'now'
  if (d < 3600000) return `${Math.floor(d / 60000)}m`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`
  return `${Math.floor(d / 86400000)}d`
}

export function Sidebar() {
  const s = useNexa()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<string | null>(null)

  const create = async (withFolder: boolean) => {
    const trimmed = name.trim()
    if (!trimmed) return
    let path = folder
    if (withFolder) {
      path = await bridge.projects.pickFolder()
      if (!path) return
    }
    await s.createProject(trimmed, withFolder ? path : null)
    setCreating(false)
    setName('')
    setFolder(null)
  }

  const collapsed = s.settings.sidebarCollapsed

  return (
    <motion.aside
      id="sidebar"
      aria-label="Projects and sessions"
      aria-hidden={collapsed}
      inert={collapsed}
      initial={false}
      animate={{ width: collapsed ? 0 : 232, opacity: collapsed ? 0 : 1 }}
      transition={SPRING_SOFT}
      className="hairline-r shrink-0 overflow-hidden"
      style={{ minWidth: 0 }}
    >
      <div id="sidebar-content" className="flex h-full w-[232px] flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Projects</span>
            <button type="button" className="btn-text" onClick={() => setCreating(true)} title="New project" aria-label="New project">
              <IconPlus size={11} />
            </button>
          </div>

          <AnimatePresence>
            {creating && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={SPRING}
                className="overflow-hidden"
              >
                <div className="mb-3 pb-3 hairline-b">
                  <input
                    autoFocus
                    className="field mb-2"
                    placeholder="Project name"
                    aria-label="Project name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void create(false) }}
                  />
                  <div className="flex items-center gap-3">
                    <button type="button" className="btn-text text-[12px]" onClick={() => void create(true)}>
                      <span className="inline-flex items-center gap-1"><IconFolder size={11} /> Folder</span>
                    </button>
                    <button type="button" className="btn-text text-[12px]" onClick={() => void create(false)}>From scratch</button>
                    <button type="button" className="btn-text ml-auto" onClick={() => setCreating(false)} aria-label="Cancel new project"><IconX size={10} /></button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mb-5">
            {s.projects.length === 0 && !creating && (
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>No projects yet.</p>
            )}
            {s.projects.map((p) => (
              <div
                key={p.id}
                className={`row group flex items-center gap-1 py-1 pl-2 text-[13px] ${p.id === s.activeProjectId ? 'row-active' : ''}`}
                style={{ color: p.id === s.activeProjectId ? 'var(--text-1)' : 'var(--text-2)' }}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate bg-transparent text-left"
                  aria-label={`Open project ${p.name}`}
                  aria-current={p.id === s.activeProjectId ? 'page' : undefined}
                  onClick={() => void s.openProject(p.id)}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  className="sidebar-delete"
                  aria-label={`Delete project ${p.name}`}
                  title="Delete project"
                  onClick={() => void s.deleteProject(p.id)}
                >
                  <IconX size={9} />
                </button>
              </div>
            ))}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <span className="label">Sessions</span>
            <button className="btn-text text-[12px]" onClick={() => void s.newSession()}>New</button>
          </div>
          <div>
            {s.sessions.length === 0 && (
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>No sessions in this project.</p>
            )}
            {s.sessions.map((session) => (
              <div
                key={session.id}
                className={`row group flex items-center gap-1 py-1 pl-2 ${session.id === s.activeSessionId ? 'row-active' : ''}`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate bg-transparent text-left text-[12px]"
                  style={{ color: session.id === s.activeSessionId ? 'var(--text-1)' : 'var(--text-2)' }}
                  aria-label={`Open session ${session.title}`}
                  aria-current={session.id === s.activeSessionId ? 'page' : undefined}
                  onClick={() => void s.openSession(session.id)}
                >
                  {session.title}
                </button>
                <span className="meta shrink-0">{relTime(session.updatedAt)}</span>
                <button
                  type="button"
                  className="sidebar-delete"
                  style={{ color: 'var(--text-3)' }}
                  aria-label={`Delete session ${session.title}`}
                  title="Delete session"
                  onClick={() => void s.deleteSession(session.id)}
                >
                  <IconX size={9} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="hairline-t px-4 py-3">
          <button className="btn-text text-[12px]" onClick={() => { void s.newSession() }}>
            <span className="inline-flex items-center gap-1.5"><IconPlus size={11} /> New chat</span>
          </button>
        </div>
      </div>
    </motion.aside>
  )
}