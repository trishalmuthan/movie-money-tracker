import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayIso } from './dates'

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
