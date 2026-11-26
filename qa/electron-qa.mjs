import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const OUT = 'qa'
const DEBUG_PORT = 9333
fsSync.mkdirSync(OUT, { recursive: true })
const errors = []
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`)
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const sample = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-electron-qa-'))
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-electron-profile-'))
await fs.mkdir(path.join(sample, 'src'))
await fs.writeFile(path.join(sample, 'package.json'), JSON.stringify({ name: 'nexa-qa-sample', private: true }, null, 2))
await fs.writeFile(path.join(sample, 'src', 'app.ts'), 'export const answer = 42\n')

let launchOutput = ''
const child = spawn(require('electron'), [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '.'
], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RENDERER_URL: '', NEXA_QA_FOLDER: sample },
  windowsHide: false,
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', (chunk) => { launchOutput = (launchOutput + chunk.toString()).slice(-4000) })
child.stderr.on('data', (chunk) => { launchOutput = (launchOutput + chunk.toString()).slice(-4000) })
const exited = new Promise((resolve) => child.once('exit', resolve))

async function connect() {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Nexa exited before QA connected.\n${launchOutput}`)
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(500) })
      if (response.ok) break
    } catch { /* wait for Electron */ }
    await wait(100)
  }
  return puppeteer.connect({
    browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
    defaultViewport: null,
    protocolTimeout: 240000
  })
}

let browser
let page
let projectId = null
try {
  browser = await connect()
  const pages = await browser.pages()
  page = pages.find((candidate) => candidate.url().includes('index.html')) ?? pages[0]
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.setViewport({ width: 1440, height: 900 })

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })
const visiblePalette = () => page.evaluate(() => {
  const properties = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke']
  const colored = []
  let checked = 0
  for (const element of document.querySelectorAll('*')) {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue
    for (const property of properties) {
      if (property.startsWith('border') && (style[property.replace('Color', 'Style')] === 'none' || Number.parseFloat(style[property.replace('Color', 'Width')]) === 0)) continue
      if (property === 'outlineColor' && (style.outlineStyle === 'none' || Number.parseFloat(style.outlineWidth) === 0)) continue
      if (property === 'stroke' && Number.parseFloat(style.strokeWidth) === 0) continue
      const value = style[property]
      const channels = value.match(/rgba?\(([^)]+)\)/)?.[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part))
      if (!channels || channels.some((channel) => !Number.isFinite(channel))) continue
      checked++
      if (!channels.every((channel) => channel === channels[0])) {
        const identity = `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}.${[...element.classList].join('.')} text=${JSON.stringify(element.textContent.trim().slice(0, 60))} parent=${element.parentElement?.tagName.toLowerCase()}.${[...(element.parentElement?.classList ?? [])].join('.')}`
        colored.push(`${identity} ${property}: ${value}`)
      }
    }
  }
  return { checked, colored: [...new Set(colored)].slice(0, 12) }
})
const checkVisiblePalette = async (name) => {
  const palette = await visiblePalette()
  ok(name, palette.colored.length === 0, JSON.stringify(palette))
}
const clickText = (text, selector = 'button', root = 'body') =>
  page.evaluate((value, query, scope) => {
    const element = [...document.querySelectorAll(scope)].flatMap((node) => [node, ...node.querySelectorAll(query)])
      .find((candidate) => candidate.matches(query) && candidate.textContent.trim().includes(value))
    if (!element) return false
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    element.click()
    return true
  }, text, selector, root)

  await page.waitForFunction('!!window.nexa', { timeout: 10000 })
  const project = await page.evaluate(async (folder) => window.nexa.projects.create({
    name: 'nexa-electron-qa',
    path: folder
  }), sample)
  projectId = project.id
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction('!!document.querySelector("h1")', { timeout: 10000 })
  await wait(800)

  const hero = await page.evaluate(() => {
    const body = getComputedStyle(document.body)
    const askbar = document.querySelector('.askbar')
    const channels = (body.color.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3)
    return {
      bridge: !!window.nexa,
      theme: document.documentElement.dataset.theme,
      background: body.backgroundColor,
      foreground: body.color,
      monochrome: channels.length === 3 && channels.every((channel) => channel === channels[0]),
      greeting: document.querySelector('h1')?.textContent.trim() ?? '',
      radius: askbar ? Number.parseFloat(getComputedStyle(askbar).borderRadius) || 0 : 0,
      suggestions: [...document.querySelectorAll('.empty-action')].length,
      legacy: /zyink\.ai|\bfree\b|—/i.test(document.body.innerText)
    }
  })
  ok('desktop bridge present', hero.bridge)
  ok('light theme is white and monochrome', hero.theme === 'light' && hero.background === 'rgb(255, 255, 255)' && hero.monochrome, JSON.stringify(hero))
  ok('current hero copy renders', hero.greeting === 'What are we working on?', hero.greeting)
  ok('rounded composer and useful prompts render', hero.radius >= 16 && hero.suggestions >= 3, JSON.stringify({ radius: hero.radius, suggestions: hero.suggestions }))
  ok('legacy or prohibited copy absent', !hero.legacy)
  await shot('electron-hero-light')
  await checkVisiblePalette('hero uses only visible grayscale colors')

  const activeLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  await page.focus('button[aria-label^="Reasoning effort:"]')
  const effortInitial = await activeLabel()
  await page.keyboard.press('ArrowDown')
  await page.waitForSelector('[role="listbox"][aria-label="Reasoning effort"]')
  const effortStart = await page.evaluate(() => ({
    label: document.activeElement?.textContent.trim(),
    inside: !!document.activeElement?.closest('[role="listbox"]')
  }))
  ok('effort listbox focuses the selected option', effortStart.inside && effortStart.label.startsWith(effortInitial?.replace('Reasoning effort: ', '') ?? ''), JSON.stringify(effortStart))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  const effortEnd = await page.evaluate(() => document.activeElement?.textContent.trim())
  ok('effort listbox supports arrows and End', effortEnd.startsWith('Max'), effortEnd)
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[aria-label="Reasoning effort: Low"]')
  ok('effort selection commits with Enter', await activeLabel() === 'Reasoning effort: Low')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Space')
  await page.waitForSelector('[aria-label="Reasoning effort: Low"]')
  ok('effort selection commits with Space', await activeLabel() === 'Reasoning effort: Low')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Escape')
  await page.waitForFunction('!document.querySelector("[role=listbox]")')
  ok('effort listbox closes with Escape and restores focus', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Reasoning effort: Low'))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Tab')
  await page.waitForFunction('!document.querySelector("[role=listbox]")')
  ok('effort listbox closes with Tab and restores focus', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Reasoning effort: Low'))

  await page.evaluate(() => {
    const composer = document.querySelector('[contenteditable="true"][aria-label="Describe what to build"]')
    composer.focus()
    composer.textContent = 'IME composition must not send'
  })
  const beforeComposition = await page.$eval('main', (node) => node.innerText)
  await page.evaluate(() => {
    const composer = document.querySelector('[contenteditable="true"][aria-label="Describe what to build"]')
    composer.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '', isComposing: true }))
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, which: 229, bubbles: true, cancelable: true, isComposing: true }))
  })
  await wait(250)
  const afterComposition = await page.$eval('main', (node) => node.innerText)
  ok('composition Enter does not submit or clear the composer', beforeComposition === afterComposition && await page.evaluate(() => document.querySelector('[contenteditable="true"]')?.textContent === 'IME composition must not send'))
  await page.evaluate(() => {
    const composer = document.querySelector('[contenteditable="true"][aria-label="Describe what to build"]')
    composer.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '', isComposing: false }))
    composer.textContent = ''
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  })

  await page.click('.model-trigger')
  await page.waitForSelector('[role="dialog"][aria-label="Model and access"]')
  await page.waitForFunction('document.activeElement?.getAttribute("aria-label") === "Search models"')
  await page.evaluate(() => document.querySelector('.model-popover [role="radio"]')?.focus())
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  const reverseWrap = await page.evaluate(() => ({
    inside: !!document.activeElement?.closest('.model-popover'),
    option: document.activeElement?.classList.contains('model-option')
  }))
  ok('model dialog traps reverse Tab at its first control', reverseWrap.inside && reverseWrap.option, JSON.stringify(reverseWrap))
  await page.keyboard.press('Tab')
  const forwardWrap = await page.evaluate(() => ({
    inside: !!document.activeElement?.closest('.model-popover'),
    radio: document.activeElement?.getAttribute('role') === 'radio'
  }))
  ok('model dialog wraps Tab from its last control', forwardWrap.inside && forwardWrap.radio, JSON.stringify(forwardWrap))
  await page.evaluate(() => document.querySelector('input[aria-label="Search models"]')?.focus())
  await wait(350)
  const picker = await page.evaluate(() => {
    const popoverElement = document.querySelector('.model-popover')
    const popover = popoverElement?.getBoundingClientRect()
    const radios = [...document.querySelectorAll('[aria-label="Access mode"] [role="radio"]')].map((node) => node.getBoundingClientRect())
    return {
      ask: document.body.innerText.includes('Read, list, and search project files'),
      agent: document.body.innerText.includes('Edit project files and run commands after your approval'),
      full: document.body.innerText.includes('Shell commands use your Windows account permissions'),
      search: !!document.querySelector('input[aria-label="Search models"]'),
      popoverVisible: !!popover && popover.top >= 0 && popover.bottom <= window.innerHeight,
      popoverScrollTop: popoverElement?.scrollTop ?? -1,
      accessVisible: radios.length === 3 && radios.every((rect) => rect.top >= 0 && rect.bottom <= window.innerHeight)
    }
  })
  ok('combined model and access picker opens', picker.ask && picker.agent && picker.full && picker.search, JSON.stringify(picker))
  ok('access controls stay inside the window', picker.popoverVisible && picker.popoverScrollTop === 0 && picker.accessVisible, JSON.stringify(picker))
  await shot('electron-model-access')
  await checkVisiblePalette('model and access picker uses only visible grayscale colors')

  await clickText('Read only', '[role="radio"]', '[aria-label="Access mode"]')
  await page.waitForFunction('document.querySelector(".model-trigger-mode")?.textContent === "Ask"')
  ok('Ask mode selects', true)
  await clickText('Approve changes', '[role="radio"]', '[aria-label="Access mode"]')
  await page.waitForFunction('document.querySelector(".model-trigger-mode")?.textContent === "Agent"')
  ok('Agent mode selects', true)

  await clickText('Fewer prompts', '[role="radio"]', '[aria-label="Access mode"]')
  await page.waitForFunction('document.body.innerText.includes("Enable Full Access?")')
  await shot('electron-full-access-confirm')
  await clickText('Go back')
  await page.waitForSelector('[aria-label="Access mode"] [role="radio"]')
  ok('Full Access confirmation can be canceled', await page.evaluate(() => !document.body.innerText.includes('Enable Full Access?') && document.querySelector('.model-trigger')?.textContent.includes('Agent')))
  await clickText('Fewer prompts', '[role="radio"]', '[aria-label="Access mode"]')
  await page.waitForFunction('document.body.innerText.includes("Enable Full Access?")')
  await clickText('Enable for next run')
  await page.waitForFunction('document.querySelector(".model-trigger-mode")?.textContent === "Full Access"')
  await page.waitForSelector('[aria-label="Access mode"] [role="radio"]')
  ok('Full Access is explicitly enabled for one run', true)
  await clickText('Approve changes', '[role="radio"]', '[aria-label="Access mode"]')
  await page.waitForFunction('document.querySelector(".model-trigger-mode")?.textContent === "Agent"')
  await page.waitForSelector('input[aria-label="Search models"]')
  await page.type('input[aria-label="Search models"]', '__nexa_no_matching_model__')
  await page.waitForFunction('document.body.innerText.includes("No matching models.")')
  ok('model search filters the catalog', true)
  await page.keyboard.press('Escape')
  await wait(250)
  ok('model dialog closes with Escape and restores trigger focus', await page.evaluate(() => !document.querySelector('.model-popover') && document.activeElement?.classList.contains('model-trigger')))

  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Settings')
    trigger.focus()
    trigger.click()
  })
  await page.waitForSelector('[role="dialog"][aria-label="Settings"]')
  await wait(350)
  await shot('electron-settings-light')
  const settingsInitialFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  ok('non-modal Settings receives keyboard focus', settingsInitialFocus === 'Settings' || settingsInitialFocus === 'Close settings', settingsInitialFocus ?? 'none')
  await page.focus('button[aria-label="Close settings"]')
  await page.keyboard.press('Escape')
  await page.waitForFunction('!document.querySelector("[aria-label=Settings]")')
  const settingsEscapeFocus = await page.evaluate(() => ({ closed: !document.querySelector('[aria-label="Settings"]'), tag: document.activeElement?.tagName, text: document.activeElement?.textContent.trim(), label: document.activeElement?.getAttribute('aria-label'), className: document.activeElement?.className }))
  ok('Settings closes with Escape and restores its trigger focus', settingsEscapeFocus.closed && settingsEscapeFocus.text === 'Settings', JSON.stringify(settingsEscapeFocus))
  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Settings')
    trigger.focus()
    trigger.click()
  })
  await page.waitForSelector('[role="dialog"][aria-label="Settings"]')
  await wait(150)
  await page.keyboard.down('Control')
  await page.keyboard.press('Comma')
  await page.keyboard.up('Control')
  await page.waitForFunction('!document.querySelector("[aria-label=Settings]")')
  const settingsShortcutFocus = await page.evaluate(() => ({ closed: !document.querySelector('[aria-label="Settings"]'), tag: document.activeElement?.tagName, text: document.activeElement?.textContent.trim(), label: document.activeElement?.getAttribute('aria-label'), className: document.activeElement?.className }))
  ok('Settings shortcut closes the panel and restores focus', settingsShortcutFocus.closed && settingsShortcutFocus.text === 'Settings', JSON.stringify(settingsShortcutFocus))
  await clickText('Settings')
  await page.waitForSelector('[role="dialog"][aria-label="Settings"]')
  await wait(350)
  await clickText('Dark', '[role="radio"]', '[aria-label="theme"]')
  await page.waitForFunction('getComputedStyle(document.body).backgroundColor === "rgb(0, 0, 0)"')
  const darkSettings = await page.evaluate(() => getComputedStyle(document.querySelector('[aria-label="Settings"]')).backgroundColor)
  ok('dark Settings is fully black', darkSettings === 'rgb(0, 0, 0)', darkSettings)
  await shot('electron-settings-dark')
  await checkVisiblePalette('dark Settings uses only visible grayscale colors')
  await clickText('Light', '[role="radio"]', '[aria-label="theme"]')
  await page.waitForFunction('getComputedStyle(document.body).backgroundColor === "rgb(255, 255, 255)"')
  await page.click('button[aria-label="Close settings"]')
  await wait(300)

  await page.keyboard.down('Control')
  await page.keyboard.press('KeyK')
  await page.keyboard.up('Control')
  await page.waitForSelector('input[placeholder*="Jump to"]')
  ok('quick switcher opens on Ctrl+K', true)
  await shot('electron-quick-switcher')
  await page.keyboard.press('Escape')
  await wait(250)

  await clickText('Code')
  await page.waitForFunction('[...document.querySelectorAll("button.row")].some((node) => node.textContent.includes("package.json"))')
  await clickText('package.json', 'button.row')
  await page.waitForSelector('.monaco-editor')
  await wait(500)
  ok('project tree opens Monaco', true)
  await shot('electron-code-editor')
  await checkVisiblePalette('code workspace uses only visible grayscale colors')

  await page.click('.monaco-editor .view-lines')
  await page.keyboard.down('Control')
  await page.keyboard.press('End')
  await page.keyboard.up('Control')
  await page.keyboard.press('Enter')
  await page.keyboard.type('// nexa qa editor save')
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyS')
  await page.keyboard.up('Control')
  await wait(500)
  const saved = await page.evaluate(async (id) => window.nexa.fs.read(id, 'package.json'), projectId)
  ok('editor save writes the project file', saved.includes('nexa qa editor save'))

  await clickText('Terminal', 'button', '.seg')
  await page.waitForSelector('.xterm')
  await wait(600)
  await page.focus('.xterm-helper-textarea')
  await page.keyboard.type('echo nexa-qa-terminal')
  await page.keyboard.press('Enter')
  await page.waitForFunction('document.querySelector(".xterm")?.textContent.includes("nexa-qa-terminal")')
  ok('terminal accepts input and renders output', true)
  await shot('electron-terminal')

  await clickText('Activity')
  await page.waitForFunction('document.body.innerText.includes("Export JSON")')
  ok('activity drawer opens', true)
  await shot('electron-activity')
  await page.keyboard.press('Escape')
  await wait(250)

  await page.click('button[title="Stop every run and terminal"]')
  await page.waitForFunction('document.body.innerText.includes("Kill switch")')
  ok('Kill stops terminals and confirms', true)

  await page.setViewport({ width: 1000, height: 700 })
  await wait(600)
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))
  ok('no horizontal overflow at 1000px', !layout.overflow, JSON.stringify(layout))
  await shot('electron-narrow')

  const realErrors = errors.filter((error) => !error.includes('favicon') && !error.includes('React DevTools'))
  ok('no runtime errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} catch (error) {
  ok('desktop QA completed', false, `${error instanceof Error ? error.stack : String(error)}${page ? '' : `\n${launchOutput}`}`)
  if (page) await page.screenshot({ path: `${OUT}/electron-failure.png` }).catch(() => {})
} finally {
  if (projectId && page) await page.evaluate(async (id) => window.nexa.projects.remove(id), projectId).catch(() => {})
  if (page) await page.evaluate(async () => window.nexa.window.close()).catch(() => {})
  if (browser) await browser.disconnect().catch(() => {})
  if (child.exitCode === null) {
    await Promise.race([exited, wait(5000)])
    if (child.exitCode === null) {
      child.kill()
      await Promise.race([exited, wait(2000)])
    }
  }
  await fs.rm(sample, { recursive: true, force: true }).catch(() => {})
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
}

fsSync.writeFileSync(`${OUT}/electron-results.json`, JSON.stringify({ results, errors }, null, 2))
console.log(`\n${results.filter((result) => result.pass).length}/${results.length} Electron checks passed`)
process.exit(results.every((result) => result.pass) ? 0 : 1)
