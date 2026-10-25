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
