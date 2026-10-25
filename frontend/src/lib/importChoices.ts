import type { Chain } from '../api/chains'
import type { ImportChoices, ImportFile, RowChoice, RowKey } from '../api/imports'

type Column = ImportChoices['fixes'][number]['column']
type Span = ImportChoices['chain_rule'][number]
type RowPatch = Omit<Partial<RowChoice>, 'file' | 'line'>

const sameRow = (a: RowKey, b: RowKey) => a.file === b.file && a.line === b.line

export function rowChoice(choices: ImportChoices, key: RowKey): RowChoice | undefined {
  return choices.rows?.find((r) => sameRow(r, key))
}

/** Merge `patch` into a row's choice. A choice left saying nothing is removed. */
export function withRowChoice(choices: ImportChoices, key: RowKey, patch: RowPatch): ImportChoices {
  const rows = choices.rows ?? []
  const current = rowChoice(choices, key)
  const base = current ?? { file: key.file, line: key.line, skip: false }
  const merged: RowChoice = { ...base, ...patch, skip: patch.skip ?? base.skip }
  const says = Object.entries(merged).some(
    ([field, value]) => field !== 'file' && field !== 'line' && value !== undefined && value !== null && value !== false,
  )
  const others = rows.filter((r) => !sameRow(r, key))
  if (!says) return { ...choices, rows: others }
  return { ...choices, rows: current ? rows.map((r) => (sameRow(r, key) ? merged : r)) : [...rows, merged] }
}

/** Replace one cell before parsing (how a bad date or amount is corrected). */
export function withFix(choices: ImportChoices, file: number, line: number, column: Column, value: string): ImportChoices {
  const fixes = choices.fixes ?? []
  const fix = { file, line, column, value }
  const index = fixes.findIndex((f) => f.file === file && f.line === line && f.column === column)
  return { ...choices, fixes: index < 0 ? [...fixes, fix] : fixes.map((f, i) => (i === index ? fix : f)) }
}

/** Remove a file; choices for it go, and later files' choices shift down one index. */
export function removeFile(files: ImportFile[], choices: ImportChoices, index: number): [ImportFile[], ImportChoices] {
  const shift = <T extends { file: number }>(items: T[] = []) =>
    items.filter((item) => item.file !== index).map((item) => (item.file > index ? { ...item, file: item.file - 1 } : item))
  return [files.filter((_, i) => i !== index), { ...choices, rows: shift(choices.rows), fixes: shift(choices.fixes) }]
}

/** Every date at the alphabetically first chain, until you add a boundary. */
export function defaultChainRule(chains: Chain[]): Span[] {
  const first = [...chains].sort((a, b) => a.name.localeCompare(b.name))[0]
  return [{ until: null, chain_id: first.id }]
}

/** Dated spans in date order, the open-ended one last (the backend takes the first that fits). */
export function sortRule(rule: Span[]): Span[] {
  return [...rule].sort((a, b) => (a.until ?? '9999-12-31').localeCompare(b.until ?? '9999-12-31'))
}

export function addBoundary(rule: Span[], until: string, chainId: number): Span[] {
  return sortRule([...rule, { until, chain_id: chainId }])
}
