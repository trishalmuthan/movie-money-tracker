/**
 * Money is integer cents everywhere, matching backend/app/domain/money.py.
 * These two functions are the only place dollar text and cents meet.
 */

const DOLLARS = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

/** Parse "$1,234.56", "0.5", "-7.17" and the like into cents; throw on anything else. */
export function parseDollars(text: string): number {
  const match = DOLLARS.exec(text.trim())
  if (match === null) {
    throw new Error(`Not a dollar amount: ${JSON.stringify(text)}`)
  }
  const [, sign, whole, fraction = '0'] = match
  const cents = Number(whole.replaceAll(',', '')) * 100 + Number(fraction.padEnd(2, '0'))
  return sign ? -cents : cents
}

export function formatCents(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  const dollars = Math.floor(abs / 100).toLocaleString('en-US')
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}$${dollars}.${cents}`
}
