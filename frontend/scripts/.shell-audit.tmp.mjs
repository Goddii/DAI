import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5173'
const SHOTS = '/tmp/dai_shots'
const fs = await import('node:fs')
fs.mkdirSync(SHOTS, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
})

try {
  const page = await browser.newPage()
  const clickByText = async (text) => {
    const ok = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('button, a')].find((b) => b.textContent?.trim().includes(t))
      if (!el) return false
      el.click()
      return true
    }, text)
    if (!ok) throw new Error(`button not found: ${text}`)
  }
  const waitForText = (text, timeout = 8000) =>
    page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text)

  // Login as the seeded demo trader.
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await page.type('input[autocomplete="tel"]', '0700000000')
  await page.type('input[type="password"]', 'dai12345')
  await clickByText('Log In')
  await waitForText("Demo's Credit Book")
  await page.screenshot({ path: `${SHOTS}/shell-01-dashboard.png` })

  // Audit helpers.
  const audit = async (label) => {
    const m = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth
      const header = document.querySelector('header')
      const headerBg = header ? getComputedStyle(header).backgroundColor : null
      const account = [...document.querySelectorAll('button, a')].find((b) => b.getAttribute('aria-label') === 'Account')
      let accountBox = null
      if (account) {
        const r = account.getBoundingClientRect()
        accountBox = { w: Math.round(r.width), h: Math.round(r.height) }
      }
      const primary = [...document.querySelectorAll('button, a')].find((b) => b.textContent?.includes('Record Credit'))
      let primaryBox = null
      if (primary) {
        const r = primary.getBoundingClientRect()
        primaryBox = { w: Math.round(r.width), h: Math.round(r.height) }
      }
      return { overflow, headerBg, accountBox, primaryBox }
    })
    console.log(`[${label}]`, JSON.stringify(m))
  }

  await audit('dashboard')
  await page.screenshot({ path: `${SHOTS}/shell-01-dashboard.png` })

  // Account sheet.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, a')].find((b) => b.getAttribute('aria-label') === 'Account')
    el?.click()
  })
  await page.waitForSelector('dialog[open]', { timeout: 4000 })
  await page.screenshot({ path: `${SHOTS}/shell-02-account-sheet.png` })
  const sheetText = await page.evaluate(() => document.querySelector('dialog[open]')?.textContent ?? '')
  console.log('[account sheet]', JSON.stringify({
    hasName: sheetText.includes('Demo Trader'),
    hasLogOut: sheetText.includes('Log Out'),
    hasSettings: sheetText.includes('Sync & settings'),
  }))
  // Close via backdrop (Esc).
  await page.keyboard.press('Escape')

  // Customers page.
  await clickByText('Customers')
  await waitForText('customers')
  await audit('customers')
  await page.screenshot({ path: `${SHOTS}/shell-03-customers.png` })

  // Customer detail (first row).
  const firstRow = await page.evaluate(() => {
    const link = document.querySelector('a[href^="/customers/"]')
    link?.click()
    return !!link
  })
  if (firstRow) {
    await waitForText('Owes you')
    await audit('customer detail')
    await page.screenshot({ path: `${SHOTS}/shell-04-customer-detail.png` })
  }

  // Settings page.
  await page.evaluate(() => window.history.back())
  await waitForText('Customers')
  await clickByText('Settings')
  await waitForText('Sync')
  await audit('settings')
  await page.screenshot({ path: `${SHOTS}/shell-05-settings.png` })
} finally {
  await browser.close()
}
