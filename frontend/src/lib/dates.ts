/**
 * Today's date as YYYY-MM-DD in the viewer's own time zone.
 * (Date.toISOString() is UTC, which turns a late-evening visit into "tomorrow".)
 */
export function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** "2026-02-15" as a local date. (new Date("2026-02-15") is UTC midnight: the 14th in the US.) */
function localDate(iso: string): Date {
  const [year, month, day = 1] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** "2026-02-15" → "Feb 15" */
export function shortDate(iso: string): string {
  return localDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "2026-02" → "February 2026" */
export function monthLabel(yearMonth: string): string {
  return localDate(yearMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
