import { useMemo } from 'react'
import type { FileNode } from '@shared/types'
import { useNexa } from '../store'
import { Composer } from './Composer'
import { IconArrowUp, IconFile } from './Icons'

const firstFiles = (nodes: FileNode[]): string[] => {
  const files: string[] = []
  const visit = (items: FileNode[]) => {
    for (const item of items) {
      if (files.length >= 4) return
      if (item.kind === 'file') files.push(item.path)
      else if (item.children) visit(item.children)
    }
  }
  visit(nodes)
  return files
}

export function Hero() {
  const project = useNexa((state) => state.projects.find((item) => item.id === state.activeProjectId))
  const tree = useNexa((state) => state.tree)
  const sessions = useNexa((state) => state.sessions)
  const files = useMemo(() => firstFiles(tree), [tree])
  const prompts = project
    ? ['Review this project for bugs', 'Explain the project structure', 'Add tests for the main module']
    : ['Create a small TypeScript project', 'Set up a project with tests', 'Explain how to structure a new codebase']

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="m-auto w-full max-w-[760px] px-8 py-10">
        <div className="relative mb-9">
          <svg
            data-nature-detail="true"
            aria-hidden="true"
            focusable="false"
            className="nature-contour absolute -right-3 -top-16 hidden h-[230px] w-[250px] sm:block"
            viewBox="0 0 250 260"
            fill="none"
          >
            <path d="M31 225C30 139 91 61 207 31C206 126 150 211 31 225Z" stroke="currentColor" strokeWidth="1.2" />
            <path d="M38 219C78 176 126 121 185 58M69 185L65 131M101 155L157 159M132 122L128 79M157 94L199 102" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
            <path d="M31 225C45 233 58 240 71 254M51 237C42 239 34 244 28 252M62 246C74 243 84 246 91 254" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
          <div className="relative">
            <div className="mb-2 text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>{project?.name ?? 'No project selected'}</div>
            <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.035em]">What are we working on?</h1>
            <p className="mt-3 max-w-[540px] text-[13px] leading-6" style={{ color: 'var(--text-2)' }}>
              {project ? 'Describe a change, ask about the code, or open a file to get started.' : 'Choose a project or start a conversation. Attach a folder when you are ready to edit code.'}
            </p>
          </div>
        </div>

        <Composer variant="hero" />

        <div className="mt-9 grid gap-x-10 gap-y-1 sm:grid-cols-2">
          <div>
            <h2 className="label mb-2">Start with</h2>
            {prompts.map((prompt) => (
              <button key={prompt} className="empty-action text-[12px]" onClick={() => void useNexa.getState().send(prompt).catch((error: unknown) => {
                useNexa.getState().showToast(error instanceof Error ? error.message : 'Could not start the run.', 'error')
              })}>
                <span>{prompt}<IconArrowUp size={12} /></span>
              </button>
            ))}
          </div>
          <div className="mt-6 sm:mt-0">
            <h2 className="label mb-2">{files.length ? 'Project files' : 'Recent sessions'}</h2>
            {files.length ? files.map((path) => (
              <button key={path} className="empty-action mono text-[11px]" onClick={() => void useNexa.getState().openFile(path)}>
                <span className="inline-flex min-w-0 items-center gap-2"><IconFile size={12} /><span className="truncate">{path}</span></span>
              </button>
            )) : sessions.slice(0, 4).map((session) => (
              <button key={session.id} className="empty-action text-[12px]" onClick={() => void useNexa.getState().openSession(session.id)}>
                <span className="truncate">{session.title}</span>
              </button>
            ))}
            {files.length === 0 && sessions.length === 0 && <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Your project files and sessions will appear here.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
