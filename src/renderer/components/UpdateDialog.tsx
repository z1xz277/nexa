import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNexa } from '../store'
import { SPRING } from '../motion'
import { useDialogFocus } from '../lib/use-dialog-focus'
import { IconRefresh, IconX } from './Icons'

function Mark() {
  return (
    <svg width="46" height="46" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M236 768C236 506 414 326 768 236C768 566 626 768 236 768ZM326 674L354 702L702 354L674 326Z" fill="var(--accent)" fillRule="evenodd" />
    </svg>
  )
}

export function UpdateDialog() {
  const s = useNexa()
  const u = s.update
  const open = s.updateOpen && u.phase !== 'idle'
  const dialogRef = useRef<HTMLElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)

  useDialogFocus(open, dialogRef, () => s.closeUpdate(), initialFocusRef)

  useEffect(() => {
    if (open) initialFocusRef.current?.focus({ preventScroll: true })
  }, [open, u.phase])

  const title = u.phase === 'downloaded' ? 'A newer nexa is ready'
    : u.phase === 'downloading' ? 'Bringing nexa up to date'
      : u.phase === 'available' ? 'A new version is available'
        : u.phase === 'checking' ? 'Checking for updates'
          : u.phase === 'error' ? 'Update interrupted' : 'Windows app updates'
  const body = u.phase === 'downloaded' ? `Version ${u.latestVersion ?? ''} is downloaded. Restart now to finish the update.`
    : u.phase === 'downloading' ? `Downloading version ${u.latestVersion ?? ''}. You can keep working.`
      : u.phase === 'available' ? `Version ${u.latestVersion ?? ''} is downloading in the background.`
        : u.phase === 'checking' ? 'This will only take a moment.'
          : u.phase === 'error' ? u.message ?? 'Please try again.'
            : u.message ?? 'Install nexa to receive automatic updates.'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ background: 'rgba(0, 0, 0, 0.66)' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget && u.phase !== 'downloaded') s.closeUpdate() }}
        >
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
            aria-describedby="update-description"
            tabIndex={-1}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={SPRING}
            className="pop relative w-full max-w-[440px] overflow-hidden p-7"
            style={{ borderRadius: 'var(--r-xl)' }}
          >
            {u.phase !== 'downloaded' && (
              <button ref={initialFocusRef} type="button" className="btn-text absolute right-4 top-4" onClick={s.closeUpdate} aria-label="Close update dialog">
                <IconX size={12} />
              </button>
            )}
            <motion.div initial={{ rotate: -8, scale: 0.85 }} animate={{ rotate: 0, scale: 1 }} transition={SPRING}>
              <Mark />
            </motion.div>
            <div className="label mb-2 mt-6">nexa {u.currentVersion}</div>
            <h2 id="update-title" className="text-[24px] font-light tracking-[-0.03em]">{title}</h2>
            <p id="update-description" className="mb-6 mt-2 text-[13px]" style={{ color: 'var(--text-2)' }}>{body}</p>

            {(u.phase === 'downloading' || u.phase === 'available') && (
              <div className="mb-6">
                <div
                  className="mb-2 flex items-center justify-between"
                  role="progressbar"
                  aria-label="Update download progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={u.phase === 'available' ? 4 : u.percent ?? 0}
                >
                  <span className="meta">Downloading</span>
                  <span className="meta">{u.percent ?? 0}%</span>
                </div>
                <div className="h-1 overflow-hidden" style={{ background: 'var(--hairline)', borderRadius: 'var(--r-full)' }}>
                  <motion.div
                    className="h-full"
                    style={{ background: 'var(--accent)', borderRadius: 'var(--r-full)' }}
                    animate={{ width: `${u.phase === 'available' ? 4 : u.percent ?? 0}%` }}
                    transition={u.phase === 'downloading' ? { duration: 0.18 } : SPRING}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              {u.phase === 'downloaded' && (
                <button ref={initialFocusRef} type="button" className="btn-primary flex items-center gap-2" onClick={() => void s.installUpdate()}>
                  Restart and update
                </button>
              )}
              {u.phase === 'error' && (
                <button ref={initialFocusRef} type="button" className="btn-primary flex items-center gap-2" onClick={() => void s.checkForUpdates()}>
                  <IconRefresh size={12} /> Try again
                </button>
              )}
              {u.phase !== 'downloaded' && u.phase !== 'error' && u.phase !== 'downloading' && (
                <button className="btn-outline" onClick={s.closeUpdate}>Close</button>
              )}
              {u.phase === 'downloading' && <span className="meta">Installs automatically when you quit</span>}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
