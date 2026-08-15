/**
 * Pass #2 audit — drives the live stack at a phone viewport and verifies the
 * refinement behaviours in a real browser. Requires backend :5000 + frontend
 * dev server :5173. Uses the seeded demo trader.
 */

import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5173'
const SHOTS = '/tmp/dai_pass2'
const fs = await import('node:fs')
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
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
  const overflow = () =>
    page.evaluate(() => ({
      x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }))

  await page.goto(BASE, { waitUntil: 'networkidle2' })

  // Login as the demo trader
  await page.type('input[autocomplete="tel"]', '0700000000')
  await page.type('input[type="password"]', 'dai12345')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Log In'))
    btn?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes("Demo's Credit Book"), { timeout: 8000 })
  check('login → dashboard', true)
  check('dashboard no horizontal overflow', !(await overflow()).x, JSON.stringify(await overflow()))

  // --- Add customer with existing debt -------------------------------------
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Add Customer'))
    btn?.click()
  })
  await page.waitForSelector('dialog[open]', { timeout: 5000 })
  check('add customer sheet opens', true)
  check('sheet no horizontal overflow', !(await overflow()).x)

  // The "Already owes you" field is present with the exact wording.
  const hasField = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('Already owes you'),
    )
    return !!label
  })
  check('has "Already owes you" field', hasField)
  await page.screenshot({ path: `${SHOTS}/01-add-sheet.png` })

  await page.type('input[placeholder="e.g. Mama Fruits"]', 'Audit Customer')
  const amountInput = await page.$('input[aria-label="Already owes you (optional)"]')
  await amountInput.type('2000')
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    const btn = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Add Customer'))
    btn?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes('History'), { timeout: 8000 })
  await page.waitForFunction(() => document.body.innerText.includes('KSh 2,000'), { timeout: 8000 })
  check('add customer + initial credit → balance KSh 2,000', true)
  const detailState = await page.evaluate(() => ({
    hasCreditRow: document.body.innerText.includes('+KSh 2,000'),
    hasRunningBalance: document.body.innerText.includes('Balance KSh 2,000'),
    owesYou: document.body.innerText.includes('Owes you'),
  }))
  check(
    'detail shows credit row + running balance',
    detailState.hasCreditRow && detailState.hasRunningBalance && detailState.owesYou,
    JSON.stringify(detailState),
  )
  await page.screenshot({ path: `${SHOTS}/02-detail-initial-credit.png` })

  // --- Back returns to the Customers list (explicit destination) -----------
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Back')
    btn?.click()
  })
  await page.waitForFunction(
    () => !!document.querySelector('input[placeholder="Search customers…"]'),
    { timeout: 8000 },
  )
  check('back → customers list', true)
  const onDashboard = await page.evaluate(() => document.body.innerText.includes("Demo's Credit Book"))
  check('back did NOT land on dashboard', !onDashboard)
  await page.screenshot({ path: `${SHOTS}/03-customers.png` })

  // --- Settings: no "Sync Now", retry only inside recovery -----------------
  await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Settings')
    link?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes('Your credit book syncs on its own'), {
    timeout: 8000,
  })
  const settingsState = await page.evaluate(() => ({
    hasSyncNow: document.body.innerText.includes('Sync Now'),
    hasRetry: document.body.innerText.includes('Retry'),
    hasWaiting: document.body.innerText.includes('Waiting to sync'),
  }))
  check('settings has no "Sync Now" button', !settingsState.hasSyncNow, JSON.stringify(settingsState))
  check('settings explains sync is automatic', true)
  await page.screenshot({ path: `${SHOTS}/04-settings.png` })

  // --- Account sheet: renamed row, no sync advertisement -------------------
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Account')
    btn?.click()
  })
  await page.waitForSelector('dialog[open]', { timeout: 5000 })
  const sheetText = await page.evaluate(() => document.querySelector('dialog[open]').innerText)
  check('account sheet shows Settings row', sheetText.includes('Settings'))
  check('account sheet no longer advertises sync', !sheetText.includes('Sync & settings'))
  check('account sheet has Log Out', sheetText.includes('Log Out'))
  await page.screenshot({ path: `${SHOTS}/05-account-sheet.png` })

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
