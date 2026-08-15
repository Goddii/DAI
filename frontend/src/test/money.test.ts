import { describe, expect, it } from 'vitest'
import { formatKsh, minorToInput, parseAmountToMinor } from '../lib/money'

describe('parseAmountToMinor', () => {
  it('parses whole shillings', () => {
    expect(parseAmountToMinor('850')).toBe(85000)
    expect(parseAmountToMinor('0')).toBe(0)
    expect(parseAmountToMinor('47850')).toBe(4785000)
  })

  it('parses decimals into cents', () => {
    expect(parseAmountToMinor('850.5')).toBe(85050)
    expect(parseAmountToMinor('850.50')).toBe(85050)
    expect(parseAmountToMinor('1.05')).toBe(105)
  })

  it('tolerates thousands separators and whitespace', () => {
    expect(parseAmountToMinor(' 47,850 ')).toBe(4785000)
  })

  it('rejects invalid input', () => {
    expect(parseAmountToMinor('')).toBeNull()
    expect(parseAmountToMinor('abc')).toBeNull()
    expect(parseAmountToMinor('850.505')).toBeNull()
    expect(parseAmountToMinor('-5')).toBeNull()
    expect(parseAmountToMinor('1e5')).toBeNull()
  })
})

describe('formatKsh', () => {
  it('formats with KSh prefix and grouping', () => {
    expect(formatKsh(4785000)).toBe('KSh 47,850')
    expect(formatKsh(85000)).toBe('KSh 850')
    expect(formatKsh(0)).toBe('KSh 0')
  })
})

describe('minorToInput', () => {
  it('round-trips with parseAmountToMinor', () => {
    for (const v of [0, 50, 85000, 85050, 4785000]) {
      expect(parseAmountToMinor(minorToInput(v))).toBe(v)
    }
  })
})
