import type { components } from '../api/schema'

export type ActivityEntry = components['schemas']['ActivityEntry']

/**
 * Money that left (or came back to) the bank across these entries: gift card purchases,
 * bank-paid visits, bank refunds. Spending *from* a gift card isn't counted again: that
 * money already left when the card was bought. Same rule as backend cash_out (spec §4).
 */
export function cashOut(entries: ActivityEntry[]): number {
  return entries.reduce((total, entry) => {
    if (entry.kind === 'gift_card') return total + entry.amount
    if (entry.payment_source === 'bank') return total + entry.amount // visits +, refunds −
    return total
  }, 0)
}

/** Newest-first entries split into months, keeping their order. */
export function groupByMonth(entries: ActivityEntry[]): { month: string; entries: ActivityEntry[] }[] {
  const groups: { month: string; entries: ActivityEntry[] }[] = []
  for (const entry of entries) {
    const month = entry.date.slice(0, 7)
    const last = groups.at(-1)
    if (last?.month === month) last.entries.push(entry)
    else groups.push({ month, entries: [entry] })
  }
  return groups
}
