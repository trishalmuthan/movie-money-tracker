import { describe, expect, it } from 'vitest'
import { cashOut, groupByMonth } from './activity'

const e = (kind: 'visit' | 'gift_card' | 'credit', date: string, amount: number, source: string | null) => ({
  kind, id: 1, date, chain_id: 1, description: '', amount, payment_source: source, effective_cost: null,
})

describe('cashOut', () => {
  it('counts card purchases and bank payments, minus bank refunds', () => {
    expect(
      cashOut([
        e('gift_card', '2026-01-01', 3500, null), // money onto a card: cash out
        e('visit', '2026-02-15', 2600, 'gift_card'), // paid from the card: not cash again
        e('visit', '2026-02-16', 500, 'bank'),
        e('visit', '2026-02-01', 0, 'free'),
        e('credit', '2026-02-20', -717, 'bank'),
        e('credit', '2026-02-21', -300, 'gift_card'), // back onto a card: not cash
      ]),
    ).toBe(3500 + 500 - 717)
  })
})

describe('groupByMonth', () => {
  it('keeps the newest-first order and groups by YYYY-MM', () => {
    const groups = groupByMonth([e('visit', '2026-02-16', 1, 'bank'), e('visit', '2026-02-01', 1, 'bank'), e('gift_card', '2026-01-01', 1, null)])
    expect(groups.map((g) => [g.month, g.entries.length])).toEqual([['2026-02', 2], ['2026-01', 1]])
  })
})
