/**
 * Money helpers. The app stores every amount as an integer of minor units
 * (cents; 1 KSh = 100). Formatting is display-only; arithmetic is always
 * done in integers so money is exact.
 */

/** "KSh 47,850" from 4_785_000 minor units. */
export function formatKsh(amountMinor: number): string {
  const shillings = amountMinor / 100
  return `KSh ${shillings.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
}

/** "47,850" — number only, for tight list rows. */
export function formatMinor(amountMinor: number): string {
  return (amountMinor / 100).toLocaleString('en-KE', { maximumFractionDigits: 0 })
}

/** "KSh 850" for entry lines with sign: "+KSh 850" / "−KSh 500". */
export function formatSigned(amountMinor: number, positive: boolean): string {
  const sign = positive ? '+' : '\u2212'
  return `${sign}${formatKsh(amountMinor)}`
}

/**
 * Parse user input like "850", "850.", "850.50" into minor units.
 * Returns null when the input is not a valid non-negative amount.
 * Whitespace and thousands separators are tolerated.
 */
export function parseAmountToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  const wholeNum = Number(whole)
  if (!Number.isSafeInteger(wholeNum)) return null
  const fracPadded = (frac + '00').slice(0, 2)
  return wholeNum * 100 + Number(fracPadded)
}

/** Format minor units back into a user-friendly input string ("850.5"). */
export function minorToInput(amountMinor: number): string {
  const shillings = amountMinor / 100
  return Number.isInteger(shillings) ? String(shillings) : shillings.toFixed(2).replace(/0+$/, '')
}
