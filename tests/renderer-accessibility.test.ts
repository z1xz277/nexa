import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer, type InlineConfig, type ViteDevServer } from 'vite'

let server: ViteDevServer
let modules: any
let initialDefaults: any

before(async () => {
  const config: InlineConfig = {
    configFile: false,
    root: resolve(import.meta.dirname, '../src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(import.meta.dirname, '../src/shared'),
        '@core': resolve(import.meta.dirname, '../src/core'),
        '@renderer': resolve(import.meta.dirname, '../src/renderer')
      }
    },
    server: { middlewareMode: true },
    ssr: { noExternal: ['@lobehub/icons'] },
    logLevel: 'silent'
  }
  server = await createServer(config)
  modules = {
    store: await server.ssrLoadModule('/store.ts'),
    components: {
      Sidebar: (await server.ssrLoadModule('/components/Sidebar.tsx')).Sidebar,
      TopBar: (await server.ssrLoadModule('/components/TopBar.tsx')).TopBar,
      Composer: (await server.ssrLoadModule('/components/Composer.tsx')).Composer,
      EffortDropdown: (await server.ssrLoadModule('/components/EffortDropdown.tsx')).EffortDropdown,
      Hero: (await server.ssrLoadModule('/components/Hero.tsx')).Hero,
      ModelPicker: (await server.ssrLoadModule('/components/ModelPicker.tsx')).ModelPicker,
      ModelLogo: (await server.ssrLoadModule('/components/Logo.tsx')).ModelLogo,
      TitleBar: (await server.ssrLoadModule('/components/TitleBar.tsx')).TitleBar
    }
  }
  const initial = modules.store.useNexa.getInitialState()
  initialDefaults = { ...initial, settings: { ...initial.settings } }
})

after(async () => {
  await server?.close()
})

beforeEach(() => {
  const initial = modules.store.useNexa.getInitialState()
  Object.assign(initial, initialDefaults, {
    settings: { ...initialDefaults.settings },
    projects: [{
      id: 'p1', name: 'Accessibility project', path: null, instructions: '',
      defaultModel: null, defaultEffort: 'medium', pinnedFiles: [], createdAt: 1
    }],
    activeProjectId: 'p1',
    sessions: [{ id: 's1', projectId: 'p1', title: 'Keyboard session', createdAt: 1, updatedAt: 2 }],
    activeSessionId: 's1'
  })
  modules.store.useNexa.setState(initial, true)
})

function render(component: any, props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(component, props))
}

function openingTags(markup: string, tag: string): string[] {
  return [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((match) => match[0])
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

test('sidebar project and session selection expose named native buttons', () => {
  const buttons = openingTags(render(modules.components.Sidebar), 'button')
  assert.ok(buttons.some((tag) => attribute(tag, 'aria-label') === 'Open project Accessibility project'))
  assert.ok(buttons.some((tag) => attribute(tag, 'aria-label') === 'Delete project Accessibility project'))
  assert.ok(buttons.some((tag) => attribute(tag, 'aria-label') === 'Open session Keyboard session'))
  assert.ok(buttons.some((tag) => attribute(tag, 'aria-label') === 'Delete session Keyboard session'))
})

test('collapsed sidebar is inert and its expansion control exposes state', () => {
  modules.store.useNexa.getInitialState().settings = { ...modules.store.useNexa.getInitialState().settings, sidebarCollapsed: true }
  const aside = openingTags(render(modules.components.Sidebar), 'aside')[0]
  assert.equal(attribute(aside, 'aria-hidden'), 'true')
  assert.equal(attribute(aside, 'inert'), '')

  const toggle = openingTags(render(modules.components.TopBar), 'button')
    .find((tag) => attribute(tag, 'aria-controls') === 'sidebar-content')
  assert.ok(toggle)
  assert.equal(attribute(toggle, 'aria-label'), 'Expand sidebar')
  assert.equal(attribute(toggle, 'aria-expanded'), 'false')
})

test('composer editor exposes a named multiline textbox', () => {
  const editor = openingTags(render(modules.components.Composer, { variant: 'hero' }), 'div')
    .find((tag) => attribute(tag, 'data-placeholder'))
  assert.ok(editor)
  assert.equal(attribute(editor, 'role'), 'textbox')
  assert.equal(attribute(editor, 'aria-multiline'), 'true')
  assert.equal(attribute(editor, 'aria-label'), 'Describe what to build')
})

test('effort trigger announces its listbox relationship', () => {
  const trigger = openingTags(render(modules.components.EffortDropdown), 'button')
    .find((tag) => attribute(tag, 'title') === 'Reasoning effort')
  assert.ok(trigger)
  assert.equal(attribute(trigger, 'aria-haspopup'), 'listbox')
  assert.equal(attribute(trigger, 'aria-expanded'), 'false')
  assert.ok(attribute(trigger, 'aria-controls'))
})

test('model trigger accessible name uses the sanitized display label', () => {
  const model = {
    id: 'ernie', provider: 'openrouter', name: 'Baidu: ERNIE-5.5-Flash-Preview (free)', context: 128000,
    capabilities: { code: true, reasoning: true, vision: false, tools: true }
  }
  Object.assign(modules.store.useNexa.getInitialState(), { models: [model], model: { id: model.id, provider: model.provider } })
  const trigger = openingTags(render(modules.components.ModelPicker), 'button')
    .find((tag) => attribute(tag, 'class')?.includes('model-trigger'))
  assert.ok(trigger)
  const label = attribute(trigger, 'aria-label') ?? ''
  assert.ok(label.includes('Baidu: ERNIE-5.5-Flash-Preview'))
  assert.doesNotMatch(label, /free/i)
})

test('model picker and preview copy do not expose routing provider brands', () => {
  const source = ['components/ModelPicker.tsx', 'mock.ts']
    .map((file) => readFileSync(resolve(import.meta.dirname, '../src/renderer', file), 'utf8'))
    .join('\n')
  assert.doesNotMatch(source, /OpenRouter|NVIDIA NIM/)
})

test('decorative model logos do not expose provider tooltips', () => {
  const markup = render(modules.components.ModelLogo, { modelId: 'nvidia/model', provider: 'nvidia' })
  assert.doesNotMatch(markup, /title=/i)
  assert.match(markup, /aria-hidden="true"/)
})

test('white theme keeps app surfaces white and primary text black', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../src/renderer/styles.css'), 'utf8')
  const light = css.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1]
  assert.ok(light)
  for (const token of ['--bg', '--elevated', '--surface', '--surface-2', '--surface-3', '--accent-soft']) {
    assert.match(light, new RegExp(`${token}:\\s*#ffffff(?:;|\\s)`))
  }
  assert.match(light, /--text-1:\s*#000000(?:;|\s)/)
  assert.match(light, /--accent:\s*#000000(?:;|\s)/)
})

test('hero botanical detail is decorative and hidden from assistive technology', () => {
  const markup = render(modules.components.Hero)
  assert.match(markup, /data-nature-detail="true"/)
  assert.match(markup, /<svg[^>]*aria-hidden="true"[^>]*data-nature-detail="true"|<svg[^>]*data-nature-detail="true"[^>]*aria-hidden="true"/)
})

test('window controls have accessible names', () => {
  const buttons = openingTags(render(modules.components.TitleBar), 'button')
  for (const name of ['Minimize', 'Maximize', 'Close']) {
    assert.ok(buttons.some((tag) => attribute(tag, 'aria-label') === name), `Missing ${name} label`)
  }
})

test('toast state retains error severity for assertive announcement', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const showToast = modules.store.useNexa.getState().showToast as (message: string, kind?: string) => void
  showToast('Could not save the file', 'error')
  assert.deepEqual(modules.store.useNexa.getState().toast, { message: 'Could not save the file', kind: 'error' })
  context.mock.timers.reset()
})
