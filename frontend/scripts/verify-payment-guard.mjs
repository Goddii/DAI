// Live verification of the payment-guard fix against the dev stack.
// Original bug: on a fresh browser, the customer is hydrated via the summary
// (balance_minor correct) but the ledger entries are never pulled, so a
// payment from the Dashboard's GLOBAL "Record Payment" button failed with
// "{name} doesn't owe anything right now" — while the sheet showed the real
// balance. The guard must reconcile the ledger first and let the payment
// through.
import puppeteer from 'puppeteer-core'

const APP = 'http://localhost:5173'
const API = 'http://localhost:5000/api'
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

async function waitForText(page, text, timeout = 10000) {
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    { timeout },
    text,
  )
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844 })

try {
  // Fresh profile → empty IndexedDB + empty outbox (the bug's precondition).
  await page.goto(APP, { waitUntil: 'networkidle0' })
  await waitForText(page, 'Log In')
  await page.type('input[autocomplete="tel"]', PHONE)
  await page.type('input[type="password"]', PASS)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Log In'))
    btn?.click()
  })
  await waitForText(page, "Demo's Credit Book")

  // Dashboard hydrates Mary from the server summary.
  await waitForText(page, 'Mary Wanjiku')
  check('fresh login hydrates Mary into "Needs attention"', true)

  // Open the GLOBAL Record Payment sheet (NOT via the customer's detail page).
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Record Payment'))
    btn?.click()
  })
  await page.waitForSelector('dialog[open]', { timeout: 5000 })

  // Pick Mary. The sheet shows her REAL balance (KSh 750) right above the
  // amount field — the exact situation that used to reject the payment.
  await page.evaluate(() => {
    const sel = document.querySelector('select')
    const opt = [...sel.options].find((o) => o.textContent.includes('Mary Wanjiku'))
    sel.value = opt.value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await waitForText(page, 'KSh 750')
  check('sheet shows the real balance (KSh 750) before paying', true)

  // Pay part of it — this used to fail with "doesn't owe anything right now".
  await page.type('input[aria-label="Amount"]', '300')
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    const btn = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Record Payment'))
    btn?.click()
  })

  // The sheet auto-closes after a successful save.
  try {
    await page.waitForSelector('dialog[open]', { hidden: true, timeout: 8000 })
    check('payment submitted and sheet closed', true)
  } catch {
    const state = await page.evaluate(() => ({
      dialogText: document.querySelector('dialog[open]')?.textContent?.slice(0, 300) ?? null,
      body: document.body.innerText.slice(0, 300),
    }))
    console.error('SHEET STATE:', JSON.stringify(state, null, 2))
    check('payment submitted and sheet closed', false)
    throw new Error('payment did not succeed')
  }

  // No false rejection, and the balance updated to 750 − 300 = 450.
  const body = await page.evaluate(() => document.body.innerText)
  check('no "doesn\'t owe anything" error', !body.includes("doesn't owe anything"))
  await waitForText(page, 'KSh 450')
  check('dashboard balance updates to KSh 450', true)

  // Server agrees: Mary owes 450 (45,000 minor), 4 ledger entries. The
  // debounced sync fires ~1.2s after the mutation — poll until it lands.
  const token = await page.evaluate(() => localStorage.getItem('dai_token'))
  let persisted = false
  let last = ''
  for (let i = 0; i < 30; i++) {
    const customers = await fetch(`${API}/customers`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json())
    const mary = customers.customers.find((c) => c.name === 'Mary Wanjiku')
    const detail = await fetch(`${API}/customers/${mary.id}/ledger`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json())
    last = `balance=${detail.balance_minor} entries=${detail.entries.length}`
    if (detail.balance_minor === 45000 && detail.entries.length === 4) {
      persisted = true
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  check('server: balance 450 with 4 entries (payment persisted exactly once)', persisted, last)

  console.log(`\n${checks - failures}/${checks} checks passed`)
} catch (err) {
  console.error('VERIFICATION ERROR:', err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
process.exit(failures > 0 || process.exitCode ? 1 : 0)
