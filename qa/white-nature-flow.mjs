import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const results = []
const errors = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`)
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clickText = (text) => page.evaluate((value) => {
  const node = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim().includes(value))
  if (!node) return false
  node.click()
  return true
}, text)

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
const page = await browser.newPage()
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(String(error)))

try {
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1')
  await wait(700)

  const hero = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const svg = document.querySelector('[data-nature-detail="true"]')
    const rect = svg?.getBoundingClientRect()
    return {
      theme: document.documentElement.dataset.theme,
      bg: style.getPropertyValue('--bg').trim(),
      text: style.getPropertyValue('--text-1').trim(),
      surfaces: [document.body, document.querySelector('.askbar')].filter(Boolean).map((node) => getComputedStyle(node).backgroundColor),
      nature: !!rect && rect.width > 0 && rect.height > 0,
      decorative: svg?.getAttribute('aria-hidden') === 'true',
      legacy: /openrouter|nvidia nim|context unavailable|—/i.test(document.body.innerText)
    }
  })
  ok('white desktop surfaces and black primary text', hero.theme === 'light' && hero.bg === '#ffffff' && hero.text === '#000000' && hero.surfaces.every((value) => value === 'rgb(255, 255, 255)'), JSON.stringify(hero))
  ok('botanical detail is visible and decorative', hero.nature && hero.decorative)
  ok('prohibited provider and unavailable-context copy is absent', !hero.legacy)
  await page.screenshot({ path: 'qa/15-white-nature-hero.png' })

  await page.click('.model-trigger')
  await page.waitForSelector('[role="dialog"][aria-label="Model and access"]')
  await wait(350)
  const picker = await page.evaluate(() => {
    const element = document.querySelector('.model-popover')
    const rect = element.getBoundingClientRect()
    const radios = [...document.querySelectorAll('[aria-label="Access mode"] [role="radio"]')].map((node) => node.getBoundingClientRect())
    return {
      text: element.innerText,
      count: document.querySelectorAll('.model-option').length,
      metas: [...document.querySelectorAll('.model-option-meta')].slice(0, 5).map((node) => node.textContent.trim()),
      headings: [...document.querySelectorAll('.model-results .label')].map((node) => node.textContent.trim()),
      background: getComputedStyle(element).backgroundColor,
      top: rect.top,
      bottom: rect.bottom,
      radiosVisible: radios.length === 3 && radios.every((radio) => radio.top >= 48 && radio.bottom <= window.innerHeight - 8)
    }
  })
  ok('model picker keeps context metadata without provider headings', picker.count > 0 && picker.metas.length > 0 && !/context unavailable/i.test(picker.text) && picker.headings.length === 0, JSON.stringify(picker))
  ok('model picker contains no visible provider names', !/openrouter|nvidia nim/i.test(picker.text))
  ok('model picker stays inside desktop viewport', picker.top >= 48 && picker.bottom <= 892 && picker.radiosVisible, JSON.stringify(picker))
  await page.screenshot({ path: 'qa/16-white-nature-model-picker.png' })
  await page.keyboard.press('Escape')
  await wait(250)

  await page.click('.askbar [contenteditable]')
  await page.keyboard.type('Add a farewell module and verify it.')
  await page.click('button[aria-label="Send message"]')
  let approvals = 0
  let done = false
  for (let index = 0; index < 100; index++) {
    const state = await page.evaluate(() => ({
      done: document.body.innerText.includes('Done. Added src/farewell.ts'),
      approval: document.body.textContent.toLowerCase().includes('approval required')
    }))
    if (state.done) {
      done = true
      break
    }
    if (state.approval) {
      approvals++
      await clickText('Approve')
      await wait(350)
    }
    await wait(200)
  }
  await wait(350)
  const chat = await page.evaluate(() => ({
    finalCopies: document.body.innerText.split('Done. Added src/farewell.ts').length - 1,
    hero: !!document.querySelector('h1'),
    composer: getComputedStyle(document.querySelector('.askbar')).backgroundColor
  }))
  ok('hero transitions into a completed chat once', done && chat.finalCopies === 1 && !chat.hero, JSON.stringify({ done, approvals, ...chat }))
  ok('demo write and command approvals remain functional', approvals >= 2, String(approvals))
  await page.screenshot({ path: 'qa/17-white-nature-chat.png' })

  await clickText('Settings')
  await page.waitForSelector('[role="dialog"][aria-label="Settings"]')
  await wait(350)
  await page.evaluate(() => document.querySelector('[aria-label="motion"] [role="radio"][aria-checked="false"]:last-of-type')?.click())
  await page.waitForFunction('document.documentElement.dataset.motion === "off"')
  const motion = await page.evaluate(() => {
    const selected = document.querySelector('[aria-label="motion"] [aria-checked="true"]')
    return {
      motion: document.documentElement.dataset.motion,
      selected: selected?.textContent.trim(),
      background: selected ? getComputedStyle(selected).backgroundColor : '',
      panel: getComputedStyle(document.querySelector('[aria-label="Settings"]')).backgroundColor,
      duration: getComputedStyle(document.querySelector('.btn-outline')).transitionDuration
    }
  })
  ok('motion Off is selected with a visible white-mode state', motion.motion === 'off' && motion.selected === 'Off' && motion.panel === 'rgb(255, 255, 255)' && motion.background !== 'rgba(0, 0, 0, 0)', JSON.stringify(motion))
  ok('reduced-motion CSS collapses control transitions', motion.duration.split(',').every((value) => parseFloat(value) <= 0.001), motion.duration)
  await page.screenshot({ path: 'qa/18-white-nature-settings.png' })
  await page.click('button[aria-label="Close settings"]')
  await wait(250)

  for (const viewport of [{ width: 1000, height: 700 }, { width: 800, height: 600 }]) {
    await page.setViewport(viewport)
    await wait(400)
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      width: window.innerWidth,
      background: getComputedStyle(document.body).backgroundColor
    }))
    ok(`compact ${viewport.width}px layout stays white without overflow`, !layout.overflow && layout.background === 'rgb(255, 255, 255)', JSON.stringify(layout))
    await page.click('.model-trigger')
    await page.waitForSelector('.model-popover')
    await wait(500)
    const bounds = await page.evaluate(() => {
      const rect = document.querySelector('.model-popover').getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: window.innerHeight, scrollTop: document.querySelector('.model-popover').scrollTop }
    })
    ok(`model picker stays inside ${viewport.width}px viewport`, bounds.top >= 48 && bounds.bottom <= viewport.height - 8 && bounds.scrollTop === 0, JSON.stringify(bounds))
    await page.keyboard.press('Escape')
    await wait(200)
  }
  await page.setViewport({ width: 1000, height: 700 })
  await wait(300)
  await page.screenshot({ path: 'qa/19-white-nature-compact.png' })

  const realErrors = errors.filter((error) => !/favicon|React DevTools/i.test(error))
  ok('no renderer runtime errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} catch (error) {
  ok('renderer QA completed', false, error instanceof Error ? error.stack : String(error))
  await page.screenshot({ path: 'qa/20-white-nature-failure.png' }).catch(() => {})
} finally {
  fs.writeFileSync('qa/white-nature-results.json', JSON.stringify({ results, errors }, null, 2))
  await browser.close()
}

console.log(`\n${results.filter((result) => result.pass).length}/${results.length} renderer checks passed`)
process.exit(results.every((result) => result.pass) ? 0 : 1)
