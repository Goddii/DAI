/**
 * End-to-end browser verification for the Dai MVP.
 *
 * Drives the installed Chrome (no browser download) through the full
 * acceptance flow at a phone viewport, capturing console errors and
 * screenshots at each step.
 *
 * Usage: node scripts/e2e-verify.mjs [baseUrl]
 * Requires: backend on :5000, frontend dev server on :5173 (default).
 */

import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const SHOTS = '/tmp/dai_shots'
const fs = await import('node:fs')
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
const consoleErrors = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
})

try {
  const page = await browser.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

  // ---- helpers --------------------------------------------------------------
  const clickByText = async (text) => {
    const clicked = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.trim().includes(t),
      )
      if (!el) return false
      el.click()
      return true
    }, text)
    if (!clicked) throw new Error(`button not found: ${text}`)
  }
  /** Click a button inside the currently open dialog (bottom sheet). */
  const clickInDialog = async (text) => {
    const clicked = await page.evaluate((t) => {
      const dialog = document.querySelector('dialog[open]')
      if (!dialog) return false
      const el = [...dialog.querySelectorAll('button')].find((b) =>
        b.textContent?.trim().includes(t),
      )
      if (!el) return false
      el.click()
      return true
    }, text)
    if (!clicked) throw new Error(`dialog button not found: ${text}`)
  }
  const waitForText = (text, timeout = 8000) =>
    page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      { timeout },
      text,
    )
  const waitForDialogClosed = (timeout = 8000) =>
    page.waitForSelector('dialog[open]', { hidden: true, timeout })
  const typeInto = async (selector, text) => {
    await page.waitForSelector(selector, { timeout: 5000 })
    await page.type(selector, text)
  }

  const phone = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

  // --- Register ---------------------------------------------------------------
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await page.screenshot({ path: `${SHOTS}/01-login.png` })

  await clickByText('New here? Create an account')
  await typeInto('input[autocomplete="name"]', 'E2E Trader')
  await typeInto('input[autocomplete="tel"]', phone)
  await typeInto('input[type="password"]', 'secret123')
  await page.screenshot({ path: `${SHOTS}/02-register-filled.png` })
  await clickByText('Create Account')
  await waitForText("E2E's Credit Book")
  check('register → dashboard', true)
  await page.screenshot({ path: `${SHOTS}/03-dashboard-empty.png` })

  // --- Add customer (navigates to their detail page) ------------------------------
  await clickByText('Add Customer')
  await typeInto('input[placeholder="e.g. Mama Fruits"]', 'Mary Wanjiku')
  await clickInDialog('Add Customer')
  await page.waitForFunction(() => location.pathname.startsWith('/customers/'), {
    timeout: 8000,
  })
  await waitForText('Owes you')
  check('add customer → detail page', true)
  await page.screenshot({ path: `${SHOTS}/04-customer-detail.png` })

  // --- Record credit 850 ----------------------------------------------------------
  await clickByText('Credit')
  await page.waitForSelector('dialog[open]', { timeout: 4000 })
  await typeInto('input[aria-label="Amount"]', '850')
  await page.screenshot({ path: `${SHOTS}/05-credit-sheet.png` })
  await clickInDialog('Record Credit')
  await waitForText('KSh 850')
  check('credit 850 → balance KSh 850', true)

  // --- Record credit 400 ------------------------------------------------------------
  await waitForDialogClosed()
  await clickByText('Credit')
  await page.waitForSelector('dialog[open]', { timeout: 4000 })
  await typeInto('input[aria-label="Amount"]', '400')
  await clickInDialog('Record Credit')
  await waitForText('KSh 1,250')
  check('credit 400 → balance KSh 1,250', true)

  // --- Record payment 500 via M-Pesa -------------------------------------------------
  await waitForDialogClosed()
  await clickByText('Payment')
  await page.waitForSelector('dialog[open]', { timeout: 4000 })
  await typeInto('input[aria-label="Amount"]', '500')
  await clickInDialog('M-Pesa')
  await page.screenshot({ path: `${SHOTS}/06-payment-sheet.png` })
  await clickInDialog('Record Payment')
  await waitForText('KSh 750')
  check('payment 500 M-Pesa → balance KSh 750', true)
  await page.screenshot({ path: `${SHOTS}/07-final-balance.png` })

  // --- History shows 3 transactions ----------------------------------------------------
  const history = await page.evaluate(() => {
    const body = document.body.innerText
    return {
      hasHistory: body.includes('History'),
      creditEntries: (body.match(/Credit/g) ?? []).length,
      paymentEntries: (body.match(/Payment/g) ?? []).length,
    }
  })
  check(
    'history shows entries',
    history.hasHistory && history.creditEntries >= 2 && history.paymentEntries >= 1,
    JSON.stringify(history),
  )

  // --- Reload: balance persists (close/reopen) -------------------------------------------
  await page.reload({ waitUntil: 'networkidle2' })
  await waitForText('KSh 750')
  check('reload → balance persists (KSh 750)', true)

  // --- Offline: record credit 250 -----------------------------------------------------------
  await page.setOfflineMode(true)
  await clickByText('Credit')
  await page.waitForSelector('dialog[open]', { timeout: 4000 })
  await typeInto('input[aria-label="Amount"]', '250')
  await clickInDialog('Record Credit')
  await waitForText('KSh 1,000')
  await page.screenshot({ path: `${SHOTS}/08-offline-credit.png` })
  check('offline credit 250 → balance KSh 1,000', true)
  const pendingText = await page.evaluate(() => document.body.innerText)
  check(
    'offline banner shown',
    /Offline · \d+ (change|changes) waiting|Saved locally|waiting for connection/.test(pendingText),
  )

  // --- Back online: syncs exactly once --------------------------------------------------------
  await page.setOfflineMode(false)
  // Let the emulated network actually come back up before signaling the app.
  await new Promise((r) => setTimeout(r, 1500))
  // puppeteer's setOfflineMode emulates the network but does NOT fire the
  // browser's online/offline events — dispatch the signal a real browser
  // sends when connectivity returns.
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  try {
    await page.waitForFunction(
      () => !/(change|changes) waiting|waiting for connection/.test(document.body.innerText),
      { timeout: 10000 },
    )
  } catch {
    const state = await page.evaluate(async () => {
      const { countPendingOps } = await import('./src/lib/db.ts')
      return {
        online: navigator.onLine,
        pending: await countPendingOps(),
        body: document.body.innerText.slice(0, 300),
      }
    })
    console.log('DEBUG reconnect state:', JSON.stringify(state, null, 2))
    throw new Error('reconnect did not sync')
  }
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('All synced'),
      { timeout: 10000 },
    )
    check('reconnect → synced banner', true)
  } catch {
    const state = await page.evaluate(() => {
      const banner = document.querySelector('.bg-attention-50, .bg-positive-50, .bg-danger-50, .bg-brand-50')
      return {
        online: navigator.onLine,
        bannerClass: banner?.className ?? null,
        bannerText: banner?.textContent?.trim() ?? null,
        body: document.body.innerText.slice(0, 200),
      }
    })
    console.log('DEBUG synced-state:', JSON.stringify(state, null, 2))
    throw new Error('All synced banner did not appear')
  }
  await page.screenshot({ path: `${SHOTS}/09-synced.png` })

  await waitForText('KSh 1,000')
  check('final balance KSh 1,000 after sync', true)

  // --- Verify on the server: exactly 4 entries, balance 1,000 ------------------------------
  const token = await page.evaluate(() => localStorage.getItem('dai_token'))
  const ledgerResp = await fetch('http://localhost:5000/api/customers', {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  const mary = ledgerResp.customers.find((c) => c.name === 'Mary Wanjiku')
  const detail = await fetch(`http://localhost:5000/api/customers/${mary.id}/ledger`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  check(
    'server: exactly 4 entries, balance 1,000',
    detail.entries.length === 4 && detail.balance_minor === 100000,
    `entries=${detail.entries.length} balance=${detail.balance_minor}`,
  )

  const errors = [...new Set(consoleErrors)]
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  console.log('\n=== SUMMARY ===')
  const failed = results.filter((r) => !r.ok)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(', '))
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
