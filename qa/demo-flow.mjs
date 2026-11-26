import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const OUT = 'qa'
fs.mkdirSync(OUT, { recursive: true })
const errors = []
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// A plain browser has no Electron preload, so window.nexa is absent and the
// app runs the in-browser demo bridge (scripted provider, virtual fs).
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(process.env.NEXA_QA_URL ?? 'http://localhost:5173', { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('!!document.querySelector("h1")', { timeout: 10000 })
await wait(600)

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` })
const clickText = (text, sel = 'button') =>
  page.evaluate((t, s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t))
    if (el) { el.click(); return true }
    return false
  }, text, sel)

ok('demo bridge active (no preload)', await page.evaluate(() => !window.nexa))

// Open the terminal first so it subscribes before the agent runs and captures
// the command output live (the sink does not replay history).
await clickText('Code')
await wait(400)
await clickText('Terminal', '.seg button')
await wait(400)

// Send a prompt to start the scripted agent loop.
await page.click('.askbar [contenteditable]')
await page.keyboard.type('Add a farewell module and verify it.')
await wait(200)
await page.click('button[aria-label="Send message"]')

let approvalsSeen = 0
let planShot = false
let done = false
for (let i = 0; i < 80; i++) {
  const st = await page.evaluate(() => ({
    approval: document.body.textContent.includes('Approval required'),
    plan: document.body.textContent.includes('Add a greeting module'),
    done: document.body.textContent.includes('Done. Added src/farewell.ts'),
    idle: ![...document.querySelectorAll('button')].some((b) => ['Pause', 'Resume'].includes(b.textContent.trim())) && ![...document.querySelectorAll('.meta')].some((el) => el.textContent.trim() === 'streaming')
  }))
  if (st.plan && !planShot) { planShot = true; await shot('demo-plan') }
  if (st.done && st.idle) { done = true; break }
  if (st.approval) {
    approvalsSeen++
    if (approvalsSeen === 1) await shot('demo-approval')
    await clickText('Approve')
    await wait(350)
  }
  await wait(250)
}
await wait(600)
await shot('demo-chat')

const fin = await page.evaluate(() => {
  const text = document.body.textContent ?? ''
  const tools = [...document.querySelectorAll('.label')].find((el) => el.textContent.trim() === 'Tools')?.parentElement
  const rows = [...(tools?.querySelectorAll(':scope > div.py-1') ?? [])].map((el) => el.textContent.trim().replace(/\s+/g, ' '))
  return {
    plan: text.includes('Add a greeting module'),
    checkpoints: text.includes('Checkpoints') && text.includes('Restore'),
    farewell: text.includes('farewell'),
    finalCopies: text.split('Done. Added src/farewell.ts').length - 1,
    toolRows: rows.length,
    pendingToolRows: tools?.querySelectorAll('.runline').length ?? 0,
    streaming: [...document.querySelectorAll('.meta')].some((el) => el.textContent.trim() === 'streaming')
  }
})
ok('agent loop reaches completion', done)
ok('approval gate exercised (write + command)', approvalsSeen >= 2, String(approvalsSeen))
ok('plan timeline renders', fin.plan)
ok('checkpoint with restore offered', fin.checkpoints)
ok('final response appears once', fin.finalCopies === 1, String(fin.finalCopies))
ok('tool calls coalesce into completed rows', fin.toolRows === 6 && fin.pendingToolRows === 0, JSON.stringify(fin))
ok('streaming clears after completion', !fin.streaming)

// Terminal (open since before the run) should show the agent's command output.
await wait(500)
const term = await page.evaluate(() => document.querySelector('.xterm')?.textContent ?? '')
ok('agent command visible in terminal', term.includes('hello from nexa'), term.slice(0, 60))
await shot('demo-terminal')

// Restore the checkpoint: the written file should disappear from the tree.
await clickText('Code', '.seg button')
await wait(400)
await clickText('Restore')
await wait(500)
const restored = await page.evaluate(() =>
  ![...document.querySelectorAll('.row')].some((e) => e.textContent.includes('farewell.ts')))
ok('checkpoint restore reverts file', restored)
await shot('demo-restored')

const realErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('React DevTools'))
ok('no runtime errors in demo flow', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

fs.writeFileSync(`${OUT}/demo-results.json`, JSON.stringify({ results, errors: realErrors }, null, 2))
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} demo checks passed`)
await browser.close()
process.exit(results.every((r) => r.pass) ? 0 : 1)