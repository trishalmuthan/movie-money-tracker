import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportChoices, ImportFile } from '../../api/imports'
import { mockApi } from '../../test/mockApi'
import { renderRoutes } from '../../test/renderRoutes'
import { ImportPage } from './ImportPage'

const CHAINS = [
  { id: 1, name: 'Cinemark', standard_ticket_price: 1400 },
  { id: 2, name: 'Regal', standard_ticket_price: 1500 },
]
const CSV = 'Item,Net Cost,Number of Tickets,Date\n(contents only matter to the real backend)\n'
const ROUTES = [{ path: '/import', element: <ImportPage /> }]

type Body = { files: ImportFile[]; choices: ImportChoices }

const PROPOSED_PERIOD = {
  chain_id: 1,
  amount: 1199,
  billing_day: 22,
  start_date: '2025-05-01',
  end_date: null,
  payment_source: 'bank',
}

/** A fake preview/commit that applies the review choices the way the real proposal does. */
function reviewApi() {
  let imported: unknown = null
  const api = mockApi({
    'GET /api/v1/chains': () => CHAINS,
    'GET /api/v1/import': () => imported,
    'POST /api/v1/import/preview': ({ body }) => propose(body as Body),
    'POST /api/v1/import/commit': ({ body }) => {
      const proposal = propose(body as Body)
      if (!proposal.ready) return { status: 422, body: { detail: proposal.blockers[0].message } }
      imported = {
        committed_at: '2026-10-25T21:04:00',
        cutoff: (body as Body).choices.cutoff,
        files: proposal.totals,
      }
      return { status: 201, body: imported }
    },
  })
  return api
}

function propose({ files, choices }: Body) {
  const choice = (line: number) => choices.rows?.find((r) => r.line === line)
  const card = choice(6)
  const phm = choice(9)
  const mine = phm?.my_cost ?? 650
  const guests = phm?.guest_cost ?? 1950
  const blockers = [
    ...(card?.face_value ? [] : [{ key: { file: 0, line: 6 }, message: 'Confirm the value of the $40.00 Cinemark card from Jul 6, 2025' }]),
    ...(mine + guests === 2600 ? [] : [{ key: { file: 0, line: 9 }, message: 'The split must add up to $26.00' }]),
  ]
  return {
    visits: [
      { key: { file: 0, line: 4 }, date: '2025-06-02', chain_id: 1, title: 'The Life of Chuck', my_cost: 500, guest_count: 0, guest_cost: 0, payment_source: choice(4)?.payment_source ?? 'bank' },
      { key: { file: 0, line: 3 }, date: '2025-05-27', chain_id: 1, title: 'Mission Impossible', my_cost: 0, guest_count: 0, guest_cost: 0, payment_source: 'free' },
      { key: { file: 0, line: 9 }, date: '2025-08-02', chain_id: 1, title: 'Project Hail Mary', my_cost: mine, guest_count: 3, guest_cost: guests, payment_source: 'gift_card' },
    ],
    credits: [{ key: { file: 0, line: 3 }, date: '2025-05-27', chain_id: 1, amount: 717, destination: choice(3)?.refund_destination ?? 'bank' }],
    cards: [{ key: { file: 0, line: 6 }, date: '2025-07-06', chain_id: 1, price_paid: 4000, face_value: card?.face_value ?? 4000, confirmed: Boolean(card?.face_value) }],
    fees: [{ key: { file: 0, line: 2 }, date: '2025-05-22', chain_id: 1, amount: 1199, payment_source: 'bank', period_index: 0 }],
    periods: choices.periods ?? [PROPOSED_PERIOD],
    left_out: [],
    errors: [],
    blockers,
    totals: files.map((f) => ({ name: f.name, rows: 8, legacy_total: 10582, tickets: 9, imported_total: 10582, imported_tickets: 9 })),
    ready: blockers.length === 0,
  }
}

function previews(api: ReturnType<typeof reviewApi>): Body[] {
  return api.calls.filter((c) => c.path === '/api/v1/import/preview').map((c) => c.body as Body)
}

async function start(user: ReturnType<typeof userEvent.setup>) {
  renderRoutes(ROUTES, '/import')
  await user.upload(await screen.findByLabelText(/Choose CSV files/), new File([CSV], '2025.csv', { type: 'text/csv' }))
  return screen.findByRole('listitem', { name: '$40.00 Cinemark card, Jul 6, 2025' })
}

async function retype(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field)
  await user.type(field, text)
  await user.tab()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 25, 20, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Import review', () => {
  it('keeps Import disabled until each card value is confirmed', async () => {
    const api = reviewApi()
    const user = userEvent.setup()
    const card = await start(user)
    const importButton = screen.getByRole('button', { name: 'Import your sheet' })
    expect(importButton).toBeDisabled()
    expect(within(screen.getByRole('list', { name: 'Before you can import' })).getByText(/Confirm the value of the \$40\.00 Cinemark card/)).toBeInTheDocument()

    await retype(user, within(card).getByLabelText('Card value'), '50')
    await user.click(within(card).getByRole('button', { name: /Confirm the value/ }))
    await vi.waitFor(() => expect(previews(api).at(-1)?.choices.rows).toContainEqual(expect.objectContaining({ line: 6, face_value: 5000 })))
    expect(await within(card).findByText('Confirmed: worth $50.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import your sheet' })).toBeEnabled()
    expect(screen.queryByRole('list', { name: 'Before you can import' })).not.toBeInTheDocument()
  })

  it('splits a paid visit and changes how it was paid', async () => {
    const api = reviewApi()
    const user = userEvent.setup()
    await start(user)
    const phm = screen.getByRole('listitem', { name: 'Project Hail Mary' })
    expect(within(phm).getByLabelText('Yours')).toHaveValue('6.50')
    expect(within(phm).getByLabelText('Guests (3)')).toHaveValue('19.50')
    await retype(user, within(phm).getByLabelText('Yours'), '26')
    await vi.waitFor(() =>
      expect(previews(api).at(-1)?.choices.rows).toContainEqual(expect.objectContaining({ line: 9, my_cost: 2600, guest_cost: 0 })),
    )
    expect(await within(screen.getByRole('listitem', { name: 'Project Hail Mary' })).findByLabelText('Guests (3)')).toHaveValue('0.00')

    const chuck = screen.getByRole('listitem', { name: 'The Life of Chuck' })
    expect(within(chuck).getByRole('radio', { name: 'Bank' })).toBeChecked()
    await user.click(within(chuck).getByRole('radio', { name: 'Gift card' }))
    await vi.waitFor(() =>
      expect(previews(api).at(-1)?.choices.rows).toContainEqual(expect.objectContaining({ line: 4, payment_source: 'gift_card' })),
    )
    // Free visits are only counted, not listed.
    expect(screen.queryByRole('listitem', { name: 'Mission Impossible' })).not.toBeInTheDocument()
  })

  it('sends a refund to a gift card instead of the bank', async () => {
    const api = reviewApi()
    const user = userEvent.setup()
    await start(user)
    const refund = screen.getByRole('listitem', { name: 'Refund for Mission Impossible' })
    await user.click(within(refund).getByRole('radio', { name: 'Gift card' }))
    await vi.waitFor(() =>
      expect(previews(api).at(-1)?.choices.rows).toContainEqual(expect.objectContaining({ line: 3, refund_destination: 'gift_card' })),
    )
  })

  it('edits a subscription period, and can go back to the proposal', async () => {
    const api = reviewApi()
    const user = userEvent.setup()
    await start(user)
    const period = screen.getByRole('listitem', { name: 'Cinemark, from May 1, 2025' })
    expect(within(period).getByText(/1 fee from your sheet\. Ongoing/)).toBeInTheDocument()
    await retype(user, within(period).getByLabelText('Monthly price'), '12.99')
    await vi.waitFor(() => expect(previews(api).at(-1)?.choices.periods).toEqual([{ ...PROPOSED_PERIOD, amount: 1299 }]))
    await user.click(await screen.findByRole('button', { name: 'Use the proposed periods' }))
    await vi.waitFor(() => expect(previews(api).at(-1)?.choices.periods).toBeNull())
  })

  it('imports, then shows what came in', async () => {
    const api = reviewApi()
    const user = userEvent.setup()
    const card = await start(user)
    expect(screen.getByText('This brings in 3 visits, 1 gift card, 1 refund, 1 fee in 1 subscription period.')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: /Confirm the value/ }))
    await user.click(await screen.findByRole('button', { name: 'Import your sheet' }, { timeout: 2000 }))
    expect(await screen.findByText('Your sheet was imported on Oct 25, 2026.')).toBeInTheDocument()
    const committed = api.calls.find((c) => c.path === '/api/v1/import/commit')?.body as Body
    expect(committed.choices.rows).toContainEqual(expect.objectContaining({ line: 6, face_value: 4000 }))
  })
})
