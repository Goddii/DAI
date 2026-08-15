/**
 * Verifies the initial-hydration fix in a real browser against the live stack.
 *
 * Uses a dedicated trader seeded with server data via the API (so the demo
 * account stays untouched), then drives the app from a fresh profile where
 * IndexedDB and the outbox are empty:
 *
 *   1. Online login  → dashboard hydrates (total, count, customers, history)
 *                      WITHOUT any mutation. This is the reported bug.
 *   2. Add a customer after hydration → no duplicates on the server.
 *   3. Offline restart with empty local store (separate fresh browser) →
 *                      must NOT claim "You're all clear".
 */

import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const API = 'http://localhost:5000/api'
const SHOTS = '/tmp/dai_hydration'
const fs = await import('node:fs')
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const launch = () =>
  puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
  })

// --- Seed a dedicated trader with server data via the API ---------------------
const phone = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const PASSWORD = 'secret123'
const register = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Hydration Tester', phone, password: PASSWORD }),
}).then((r) => r.json())
const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${register.token}` }

const seeded = [
  { name: 'Mary Wanjiku', credit: 85000, creditNote: 'Tomatoes + onions' },
  { name: 'John Kamau', credit: 380000, creditNote: 'Stock' },
  { name: 'Peter Otieno', credit: 245000, creditNote: null },
  { name: 'Mama Fruits', credit: 0, creditNote: null },
]
const customers = []
for (const c of seeded) {
  const created = await fetch(`${API}/customers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: c.name, client_uuid: crypto.randomUUID() }),
  }).then((r) => r.json())
  customers.push(created)
  if (c.credit > 0) {
    await fetch(`${API}/ledger/credit`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ customer_id: created.id, amount_minor: c.credit, note: c.creditNote }),
    })
  }
}
const EXPECTED_TOTAL = 85000 + 380000 + 245000 // KSh 7,100
check('seeded 4 customers + credits via API', customers.length === 4)

// --- 1. Fresh browser, online login: hydration without any mutation -----------
const browser = await launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (err) => check('no page errors', false, err.message))
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await page.type('input[autocomplete="tel"]', phone)
  await page.type('input[type="password"]', PASSWORD)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Log In'))
    btn?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes("Hydration's Credit Book"), {
    timeout: 8000,
  })

  // The exact bug: dashboard must hydrate from the server, no mutation needed.
  await page.waitForFunction(() => document.body.innerText.includes('KSh 7,100'), { timeout: 10000 })
  check('fresh login hydrates the correct total (KSh 7,100) without any mutation', true)
  await page.screenshot({ path: `${SHOTS}/01-hydrated-dashboard.png` })

  const dash = await page.evaluate(() => {
    const t = document.body.innerText
    return {
      hasMary: t.includes('Mary Wanjiku'),
      hasJohn: t.includes('John Kamau'),
      hasPeter: t.includes('Peter Otieno'),
      allClear: t.includes("You're all clear"),
    }
  })
  check(
    'server customers appear, no false empty state',
    dash.hasMary && dash.hasJohn && dash.hasPeter && !dash.allClear,
    JSON.stringify(dash),
  )

  // --- Customer list + history --------------------------------------------------
  await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Customers')
    link?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes('Mama Fruits'), { timeout: 8000 })
  check('customers list contains all server customers', true)

  await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('Mary Wanjiku'))
    link?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes('Tomatoes + onions'), { timeout: 8000 })
  check('customer detail pulls server history', true)
  await page.screenshot({ path: `${SHOTS}/02-history.png` })

  // --- Add a customer after hydration: no duplicates -----------------------------
  await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Customers')
    link?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes('Mama Fruits'), { timeout: 8000 })
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Add Customer'))
    btn?.click()
  })
  await page.waitForSelector('dialog[open]', { timeout: 5000 })
  await page.type('input[placeholder="e.g. Mama Fruits"]', 'New Market Friend')
  await page.type('input[aria-label="Already owes you (optional)"]', '300')
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    const btn = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Add Customer'))
    btn?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes('New Market Friend'), { timeout: 8000 })

  // Poll the server until the new customer's sync lands (no fixed sleep).
  const token = await page.evaluate(() => localStorage.getItem('dai_token'))
  let synced = false
  for (let i = 0; i < 30; i++) {
    const resp = await fetch(`${API}/customers`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json())
    const names = resp.customers.map((c) => c.name)
    const dupes = names.filter((n) => n === 'New Market Friend').length
    if (dupes === 1) {
      synced = true
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  check('new customer synced to the server', synced)
  const finalResp = await fetch(`${API}/customers`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  const counts = {}
  for (const c of finalResp.customers) counts[c.name] = (counts[c.name] ?? 0) + 1
  const noDupes = Object.values(counts).every((n) => n === 1) && finalResp.customers.length === 5
  check('no duplicate customers after hydration + add', noDupes, JSON.stringify(counts))
} catch (err) {
  console.error('VERIFICATION ERROR:', err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}

// --- 2. Separate fresh browser: offline restart with empty local store ----------
const offlineBrowser = await launch()
try {
  const offPage = await offlineBrowser.newPage()
  await offPage.goto(BASE, { waitUntil: 'networkidle2' })
  // Seed the session via the same-origin proxy. IndexedDB stays untouched.
  const seededSession = await offPage.evaluate(
    async ({ p, pw }) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p, password: pw }),
      })
      if (!res.ok) return false
      const { token, trader } = await res.json()
      localStorage.setItem('dai_token', token)
      localStorage.setItem('dai_trader', JSON.stringify(trader))
      return true
    },
    { p: phone, pw: PASSWORD },
  )
  check('seeded authenticated session for offline test', seededSession)
  const idbDbs = await offPage.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  check('IndexedDB empty before offline restart', !idbDbs.includes('dai-ledger'), JSON.stringify(idbDbs))

  // Offline restart: block /api, override navigator.onLine, reload the shell.
  await offPage.setRequestInterception(true)
  offPage.on('request', (req) => {
    if (req.url().includes('/api/')) req.abort()
    else req.continue()
  })
  await offPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
  })
  await offPage.reload({ waitUntil: 'domcontentloaded' })
  await offPage.waitForFunction(() => document.body.innerText.includes("Hydration's Credit Book"), {
    timeout: 8000,
  })
  await new Promise((r) => setTimeout(r, 1200))
  const offState = await offPage.evaluate(async () => ({
    onLine: navigator.onLine,
    body: document.body.innerText.slice(0, 400),
  }))
  check('offline restart is actually offline', offState.onLine === false)
  check(
    'offline restart: no false "You\'re all clear"',
    !offState.body.includes("You're all clear"),
  )
  check(
    'offline restart: explains records will load online',
    offState.body.includes('back online'),
  )
  await offPage.screenshot({ path: `${SHOTS}/03-offline-empty.png` })
} catch (err) {
  console.error('OFFLINE VERIFICATION ERROR:', err.message)
  process.exitCode = 1
} finally {
  await offlineBrowser.close()
}

console.log('\n=== SUMMARY ===')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '))
  process.exitCode = 1
}
