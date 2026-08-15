import puppeteer from 'puppeteer-core'
const BASE = 'http://localhost:5173'
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
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
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await page.type('input[autocomplete="tel"]', '0700000000')
  await page.type('input[type="password"]', 'dai12345')
  await clickByText('Log In')
  await waitForText("Demo's Credit Book")
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Add Customer'))
    el?.click()
  })
  await page.waitForSelector('dialog[open]', { timeout: 4000 })
  await page.type('input[placeholder="e.g. Mama Fruits"]', 'Mary Wanjiku')
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    const el = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Add Customer'))
    el?.click()
  })
  await page.waitForFunction(() => location.pathname.startsWith('/customers/'), { timeout: 8000 })
  await new Promise((r) => setTimeout(r, 1200)) // let the detail page settle
  const state = await page.evaluate(() => ({
    path: location.pathname,
    body: document.body.innerText.slice(0, 500),
    buttons: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() || b.getAttribute('aria-label')),
  }))
  console.log(JSON.stringify(state, null, 2))
} finally { await browser.close() }
