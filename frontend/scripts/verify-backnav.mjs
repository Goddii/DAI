// Live verification of contextual back navigation against the dev stack.
// Scenario (per the fix brief):
//   Dashboard → tap customer in "Needs attention" → record a payment
//   → tap back → land on the Dashboard (not Customers).
// Plus the inverse: Customers → customer → back → Customers,
// and a direct deep link (no origin state) → back → Customers.
import puppeteer from 'puppeteer-core'

const APP = 'http://localhost:5173'
const PHONE = '0700000000'
const PASS = 'dai12345'
let failures = 0
let checks = 0

function check(name, ok, extra = '') {
  checks++
  if (ok) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function waitForText(page, text, timeout = 8000) {
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    { timeout },
    text,
  )
}

/** Click a button whose visible text includes `text`. */
async function clickButton(page, text) {
  const clicked = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(t))
    if (!el) return false
    el.click()
    return true
  }, text)
  if (!clicked) throw new Error(`button not found: ${text}`)
}

/** Click a button inside the currently open dialog (bottom sheet). */
async function clickInDialog(page, text) {
  const clicked = await page.evaluate((t) => {
    const dialog = document.querySelector('dialog[open]')
    if (!dialog) return false
    const el = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(t))
    if (!el) return false
    el.click()
    return true
  }, text)
  if (!clicked) throw new Error(`dialog button not found: ${text}`)
}

/** Wait for Mary's row to render, then open her detail page via a real click. */
async function openCustomer(page, name) {
  await waitForText(page, name, 10000)
  const href = await page.evaluate((n) => {
    const el = [...document.querySelectorAll('a')].find((a) => a.textContent.includes(n))
    return el?.getAttribute('href')
  }, name)
  if (!href) throw new Error(`customer link not found: ${name}`)
  await page.click(`a[href="${href}"]`)
  await waitForText(page, 'History')
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844 })

try {
  // Log in as the demo trader.
  await page.goto(APP, { waitUntil: 'networkidle0' })
  await waitForText(page, 'Log In')
  await page.type('input[autocomplete="tel"]', PHONE)
  await page.type('input[type="password"]', PASS)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Log In'))
    btn?.click()
  })
  await waitForText(page, "Demo's Credit Book")

  // 1. Dashboard shows the demo customer in "Needs attention" (after the
  //    fresh-profile hydration pulls her from the server).
  await waitForText(page, 'Needs attention')
  await waitForText(page, 'Mary Wanjiku', 10000)
  check('dashboard "Needs attention" shows Mary Wanjiku', true)

  // 2. Open Mary from the Dashboard, record a payment.
  await openCustomer(page, 'Mary Wanjiku')
  check('customer detail opened from dashboard', true)

  await clickButton(page, 'Payment')
  await page.waitForSelector('dialog[open]', { timeout: 5000 })
  await page.type('input[aria-label="Amount"]', '50')
  await clickInDialog(page, 'Record Payment')
  await page.waitForSelector('dialog[open]', { hidden: true, timeout: 8000 })

  // 3. Back → should land on the Dashboard, NOT Customers.
  await page.click('button[aria-label="Back"]')
  await waitForText(page, "Demo's Credit Book")
  const onDashboard = await page.evaluate(() => document.body.innerText.includes('Needs attention'))
  const notCustomers = !(await page.evaluate(() => document.body.innerText.includes('Search customers')))
  check('back after dashboard-origin payment returns to Dashboard', onDashboard)
  check('back did not land on the Customers list', notCustomers)

  // 4. From the Customers page: open Mary → back → Customers.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Customers')
    el?.click()
  })
  await page.waitForFunction(() => location.pathname === '/customers', { timeout: 8000 })
  await openCustomer(page, 'Mary Wanjiku')
  await page.click('button[aria-label="Back"]')
  await page.waitForFunction(() => location.pathname === '/customers', { timeout: 8000 })
  check('back after customers-origin returns to Customers list', true)

  // 5. Direct deep link to the detail URL (no origin state) → back → Customers.
  const uuid = await page.evaluate(() => {
    const el = [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Mary Wanjiku'))
    return el?.getAttribute('href')?.split('/').pop()
  })
  if (uuid) {
    await page.goto(`${APP}/customers/${uuid}`, { waitUntil: 'networkidle0' })
    await waitForText(page, 'History')
    await page.click('button[aria-label="Back"]')
    await page.waitForFunction(() => location.pathname === '/customers', { timeout: 8000 })
    check('deep link (no origin) falls back to Customers list', true)
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
} catch (err) {
  console.error('VERIFICATION ERROR:', err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
process.exit(failures > 0 || process.exitCode ? 1 : 0)
