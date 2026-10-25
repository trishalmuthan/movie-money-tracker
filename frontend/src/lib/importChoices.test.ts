import { describe, expect, it } from 'vitest'
import type { ImportChoices } from '../api/imports'
import {
  addBoundary,
  defaultChainRule,
  removeFile,
  rowChoice,
  sortRule,
  withFix,
  withRowChoice,
} from './importChoices'

const BASE: ImportChoices = { cutoff: '2026-10-25', chain_rule: [{ until: null, chain_id: 1 }], rows: [], fixes: [], periods: null }

describe('row choices', () => {
  it('adds, merges and reads a row choice', () => {
    let c = withRowChoice(BASE, { file: 0, line: 8 }, { skip: true })
    c = withRowChoice(c, { file: 0, line: 3 }, { face_value: 5000 })
    c = withRowChoice(c, { file: 0, line: 3 }, { chain_id: 2 })
    expect(c.rows).toEqual([
      { file: 0, line: 8, skip: true },
      { file: 0, line: 3, skip: false, face_value: 5000, chain_id: 2 },
    ])
    expect(rowChoice(c, { file: 0, line: 3 })).toEqual({ file: 0, line: 3, skip: false, face_value: 5000, chain_id: 2 })
    expect(rowChoice(c, { file: 1, line: 3 })).toBeUndefined()
    expect(BASE.rows).toEqual([]) // never mutated
  })

  it('drops a choice that no longer says anything', () => {
    const skipped = withRowChoice(BASE, { file: 0, line: 8 }, { skip: true })
    expect(withRowChoice(skipped, { file: 0, line: 8 }, { skip: false }).rows).toEqual([])
  })
})

describe('fixes', () => {
  it('sets and replaces a cell fix', () => {
    let c = withFix(BASE, 0, 8, 'Date', '8/1/2025')
    c = withFix(c, 0, 8, 'Date', '8/2/2025')
    c = withFix(c, 0, 8, 'Net Cost', '0')
    expect(c.fixes).toEqual([
      { file: 0, line: 8, column: 'Date', value: '8/2/2025' },
      { file: 0, line: 8, column: 'Net Cost', value: '0' },
    ])
  })
})

describe('removeFile', () => {
  it('drops the file and renumbers what later files chose', () => {
    let c = withRowChoice(BASE, { file: 0, line: 3 }, { skip: true })
    c = withRowChoice(c, { file: 1, line: 4 }, { skip: true })
    c = withFix(c, 1, 5, 'Date', '1/1/2026')
    const [files, next] = removeFile([{ name: 'a.csv', text: '' }, { name: 'b.csv', text: '' }], c, 0)
    expect(files.map((f) => f.name)).toEqual(['b.csv'])
    expect(next.rows).toEqual([{ file: 0, line: 4, skip: true }])
    expect(next.fixes).toEqual([{ file: 0, line: 5, column: 'Date', value: '1/1/2026' }])
  })
})

describe('chain rule', () => {
  it('starts with every date at the first chain', () => {
    expect(defaultChainRule([{ id: 2, name: 'Regal', standard_ticket_price: 1500 }, { id: 1, name: 'Cinemark', standard_ticket_price: 1400 }])).toEqual([
      { until: null, chain_id: 1 },
    ])
  })

  it('adds a boundary before the open-ended span, keeping dates in order', () => {
    const rule = addBoundary([{ until: null, chain_id: 2 }], '2025-10-31', 1)
    expect(rule).toEqual([
      { until: '2025-10-31', chain_id: 1 },
      { until: null, chain_id: 2 },
    ])
    expect(sortRule([{ until: null, chain_id: 2 }, { until: '2026-01-01', chain_id: 3 }, { until: '2025-01-01', chain_id: 1 }])).toEqual([
      { until: '2025-01-01', chain_id: 1 },
      { until: '2026-01-01', chain_id: 3 },
      { until: null, chain_id: 2 },
    ])
  })
})
