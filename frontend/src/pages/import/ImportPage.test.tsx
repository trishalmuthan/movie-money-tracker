import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportChoices, ImportFile } from '../../api/imports'
import { mockApi } from '../../test/mockApi'
import { renderRoutes } from '../../test/renderRoutes'
import { ImportPage } from './ImportPage'

const CHAINS = [
  { id: 2, name: 'Regal', standard_ticket_price: 1500 },
  { id: 1, name: 'Cinemark', standard_ticket_price: 1400 },
]

// The plan's made-up reference 2025.csv.
const CSV_2025 = `Item,Net Cost,Number of Tickets,Date
May 2025 Movie Club Fee,11.99,,5/22/2025
Mission Impossible,-7.17,1,5/27/2025
The Life of Chuck,5.00,1,6/2/2025
Superman,0.00,4,7/15/2025
Cinemark Gift Card,40.00,,7/6/2025
Bugonia,1.75,2,11/4/2025
Mystery row,abc,1,13/40/2025
`

const ROUTES = [{ path: '/import', element: <ImportPage /> }]

type Body = { files: ImportFile[]; choices: ImportChoices }

/** A fake preview that behaves like the real one for what this screen shows. */
function importApi({ chains = CHAINS, imported = null as unknown } = {}) {
  return mockApi({
    'GET /api/v1/chains': () => chains,
    'GET /api/v1/import': () => imported,
    'POST /api/v1/import/preview': ({ body }) => {
      const { files, choices } = body as Body
      const mystery = { file: 0, line: 8 }
      const skipped = choices.rows?.some((r) => r.line === 8 && r.skip)
      const fixed = choices.fixes?.some((f) => f.line === 8)
      const errors =
        skipped || fixed
          ? []
          : [
              { ...mystery, item: 'Mystery row', column: 'Net Cost', value: 'abc', message: 'Not an amount, like 5.00 or -7.17' },
              { ...mystery, item: 'Mystery row', column: 'Date', value: '13/40/2025', message: 'Not a date, like 5/22/2025' },
            ]
      const left_out = [
        ...(choices.cutoff <= '2025-11-04'
          ? [{ key: { file: 0, line: 7 }, item: 'Bugonia', date: '2025-11-04', reason: 'after_cutoff' }]
          : []),
        ...(skipped ? [{ key: mystery, item: 'Mystery row', date: null, reason: 'skipped' }] : []),
      ]
      return {
        visits: [],
        credits: [],
        cards: [],
        fees: [],
        periods: [],
        left_out,
        errors,
        blockers: [],
        totals: files.map((f) => ({
          name: f.name,
          rows: 7,
          legacy_total: 5157,
          tickets: 8,
          imported_total: 4982,
          imported_tickets: 6,
        })),
        ready: false,
      }
    },
  })
}

function previews(api: ReturnType<typeof importApi>): Body[] {
  return api.calls.filter((c) => c.path === '/api/v1/import/preview').map((c) => c.body as Body)
}

/** Open the page and add the reference tab. */
async function upload(user: ReturnType<typeof userEvent.setup>, name = '2025.csv') {
  renderRoutes(ROUTES, '/import')
  const input = await screen.findByLabelText(/Choose CSV files/)
  await user.upload(input, new File([CSV_2025], name, { type: 'text/csv' }))
  return screen.findByRole('listitem', { name })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 25, 20, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Import your sheet', () => {
  it('reads an uploaded tab and shows what its sheet adds up to', async () => {
    const api = importApi()
    const user = userEvent.setup()
    const file = await upload(user)
    expect(await within(file).findByText('7 rows')).toBeInTheDocument()
    expect(within(file).getByText('Sheet total $51.57, 8 tickets')).toBeInTheDocument()
    expect(previews(api).at(-1)).toEqual({
      files: [{ name: '2025.csv', text: CSV_2025 }],
      choices: {
        cutoff: '2026-10-25',
        chain_rule: [{ until: null, chain_id: 1 }], // Cinemark: first alphabetically
        rows: [],
        fixes: [],
        periods: null,
      },
    })
  })

  it('splits dates between chains', async () => {
    const api = importApi()
    const user = userEvent.setup()
    await upload(user)
    await user.click(screen.getByRole('button', { name: 'Add a date boundary' }))
    fireEvent.change(screen.getByLabelText('Up to and including'), { target: { value: '2025-10-31' } })
    await user.selectOptions(screen.getByLabelText('Chain after that'), 'Regal')
    await vi.waitFor(() =>
      expect(previews(api).at(-1)?.choices.chain_rule).toEqual([
        { until: '2025-10-31', chain_id: 1 },
        { until: null, chain_id: 2 },
      ]),
    )
    await user.click(screen.getByRole('button', { name: 'Remove the boundary at Oct 31, 2025' }))
    await vi.waitFor(() => expect(previews(api).at(-1)?.choices.chain_rule).toEqual([{ until: null, chain_id: 2 }]))
  })

  it('moves the cutoff and lists rows it leaves out', async () => {
    const api = importApi()
    const user = userEvent.setup()
    await upload(user)
    fireEvent.change(screen.getByLabelText('Cutoff date'), { target: { value: '2025-11-01' } })
    await vi.waitFor(() => expect(previews(api).at(-1)?.choices.cutoff).toBe('2025-11-01'))
    const leftOut = await screen.findByRole('group', { name: '1 row left out' })
    expect(within(leftOut).getByText('Bugonia')).toBeInTheDocument()
    expect(within(leftOut).getByText('On or after the cutoff')).toBeInTheDocument()
  })

  it('fixes an unreadable row', async () => {
    const api = importApi()
    const user = userEvent.setup()
    await upload(user)
    const problem = await screen.findByRole('group', { name: 'Line 8 of 2025.csv: Mystery row' })
    const date = within(problem).getByLabelText('Date')
    expect(date).toHaveValue('13/40/2025')
    expect(within(problem).getByText('Not a date, like 5/22/2025')).toBeInTheDocument()
    await user.clear(date)
    await user.type(date, '8/1/2025')
    await user.tab()
    await vi.waitFor(() =>
      expect(previews(api).at(-1)?.choices.fixes).toEqual([{ file: 0, line: 8, column: 'Date', value: '8/1/2025' }]),
    )
    expect(await screen.findByText('Every row could be read.')).toBeInTheDocument()
  })

  it('skips an unreadable row, and can undo it', async () => {
    importApi()
    const user = userEvent.setup()
    await upload(user)
    await user.click(await screen.findByRole('button', { name: 'Skip line 8 of 2025.csv' }))
    const leftOut = await screen.findByRole('group', { name: '1 row left out' })
    expect(within(leftOut).getByText('Mystery row')).toBeInTheDocument()
    expect(within(leftOut).getByText('Skipped')).toBeInTheDocument()
    await user.click(within(leftOut).getByRole('button', { name: 'Undo skip of Mystery row' }))
    expect(await screen.findByRole('group', { name: 'Line 8 of 2025.csv: Mystery row' })).toBeInTheDocument()
  })

  it('removes a file', async () => {
    importApi()
    const user = userEvent.setup()
    const file = await upload(user)
    await user.click(within(file).getByRole('button', { name: 'Remove 2025.csv' }))
    expect(screen.queryByRole('listitem', { name: '2025.csv' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cutoff date')).not.toBeInTheDocument()
  })

  it('shows the import instead once it has happened', async () => {
    importApi({
      imported: {
        committed_at: '2026-10-25T21:04:00',
        cutoff: '2026-10-25',
        files: [{ name: '2025.csv', rows: 37, legacy_total: 22800, tickets: 37, imported_total: 22800, imported_tickets: 37 }],
      },
    })
    renderRoutes(ROUTES, '/import')
    expect(await screen.findByText('Your sheet was imported on Oct 25, 2026.')).toBeInTheDocument()
    const file = screen.getByRole('listitem', { name: '2025.csv' })
    expect(within(file).getByText('Sheet total $228.00, 37 tickets')).toBeInTheDocument()
    expect(within(file).getByText('Imported $228.00, 37 tickets')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Choose CSV files/)).not.toBeInTheDocument()
  })

  it('needs a chain first', async () => {
    importApi({ chains: [] })
    renderRoutes(ROUTES, '/import')
    expect(await screen.findByRole('link', { name: 'Add a chain in Settings' })).toBeInTheDocument()
  })
})

