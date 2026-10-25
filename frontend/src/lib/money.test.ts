import { describe, expect, it } from 'vitest'
import { discountPercent, formatCents, parseDollars } from './money'

// Same cases as backend/tests/domain/test_money.py, so both sides agree on every input.
describe('parseDollars', () => {
  it.each([
    ['5.99', 599],
    ['$5.99', 599],
    [' 0.50 ', 50],
    ['0.5', 50],
    ['35', 3500],
    ['0.00', 0],
    ['-7.17', -717],
    ['-$7.17', -717],
    ['$1,234.56', 123456],
  ])('parses %j as %i cents', (text, cents) => {
    expect(parseDollars(text)).toBe(cents)
  })

  it.each(['', '   ', 'abc', '1.234', '5.99.1', '$', '1,23.00', '--5'])(
    'rejects %j',
    (text) => {
      expect(() => parseDollars(text)).toThrow(/Not a dollar amount/)
    },
  )
})

describe('formatCents', () => {
  it.each([
    [599, '$5.99'],
    [0, '$0.00'],
    [-717, '-$7.17'],
    [123456, '$1,234.56'],
    [5, '$0.05'],
  ])('formats %i as %j', (cents, text) => {
    expect(formatCents(cents)).toBe(text)
  })
})

describe('discountPercent', () => {
  it.each([
    [3500, 5000, 30], // $35 for $50
    [3999, 5000, 20], // 20.02% rounds to 20
    [4750, 5000, 5],
    [5000, 5000, 0],
  ])('price %i for face %i is %i%% off', (price, face, percent) => {
    expect(discountPercent(price, face)).toBe(percent)
  })
})
