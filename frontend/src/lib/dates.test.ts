import { afterEach, describe, expect, it, vi } from 'vitest'
import { longDate, monthLabel, ordinal, shortDate, todayIso } from './dates'

afterEach(() => {
  vi.useRealTimers()
})

describe('todayIso', () => {
  it('is the local calendar date, even late at night', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 11:30 pm local time: in UTC this is often already tomorrow.
    vi.setSystemTime(new Date(2026, 9, 15, 23, 30))
    expect(todayIso()).toBe('2026-10-15')
  })

  it('pads single-digit months and days', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 5, 9, 0))
    expect(todayIso()).toBe('2026-01-05')
  })
})

describe('labels', () => {
  it('formats a day without shifting it across time zones', () => {
    expect(shortDate('2026-02-15')).toBe('Feb 15')
    expect(shortDate('2026-01-01')).toBe('Jan 1')
  })

  it('names a month', () => {
    expect(monthLabel('2026-02')).toBe('February 2026')
  })
})

describe('longDate', () => {
  it('includes the year, without shifting the day', () => {
    expect(longDate('2026-01-01')).toBe('Jan 1, 2026')
    expect(longDate('2026-05-31')).toBe('May 31, 2026')
  })
})

describe('ordinal', () => {
  it('suffixes billing days', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '28th',
    ])
  })
})
