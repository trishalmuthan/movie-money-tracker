import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mockApi'
import { renderRoutes } from '../test/renderRoutes'
import { ActivityPage } from './ActivityPage'

type Entry = {
  kind: 'visit' | 'fee' | 'gift_card' | 'credit'
  id: number
  date: string
  chain_id: number | null
  description: string
  amount: number
  payment_source: string | null
  effective_cost: number | null
  is_overridden?: boolean
}

// The M1 reference scenario plus a $7.17 bank refund, as GET /activity returns it.
const SCENARIO: Entry[] = [
  { kind: 'credit', id: 1, date: '2026-02-20', chain_id: 1, description: 'Refund', amount: -717, payment_source: 'bank', effective_cost: null },
  { kind: 'visit', id: 2, date: '2026-02-16', chain_id: 1, description: 'How to Make a Killing', amount: 500, payment_source: 'bank', effective_cost: 500 },
  { kind: 'visit', id: 1, date: '2026-02-15', chain_id: 1, description: 'Project Hail Mary (+3 guests)', amount: 2600, payment_source: 'gift_card', effective_cost: 1820 },
  { kind: 'gift_card', id: 1, date: '2026-01-01', chain_id: 1, description: 'Regal gift card ($50.00 value)', amount: 3500, payment_source: null, effective_cost: 3500 },
]
const CHAINS = [{ id: 1, name: 'Regal', standard_ticket_price: 1500 }]

function activityApi({
  entries = SCENARIO,
  wallets = [{ chain_id: 1, chain_name: 'Regal', balance: 2400, uncovered: 0, runway_months: null as number | null }],
} = {}) {
  let current = [...entries]
  let currentWallets = [...wallets]
  const api = mockApi({
    'GET /api/v1/chains': () => CHAINS,
    'GET /api/v1/wallets': () => currentWallets,
    'GET /api/v1/activity': ({ query }) =>
      current.filter(
        (e) =>
          (!query.get('kind') || e.kind === query.get('kind')) &&
          (!query.get('chain_id') || e.chain_id === Number(query.get('chain_id'))) &&
          (!query.get('month') || e.date.startsWith(query.get('month')!)),
      ),
    'DELETE /api/v1/visits/:id': ({ params }) => {
      current = current.filter((e) => !(e.kind === 'visit' && e.id === Number(params.id)))
      currentWallets = currentWallets.map((w) => ({ ...w, balance: 5000 }))
      return { status: 204 }
    },
  })
  return api
}

const ROUTES = [{ path: '/activity', element: <ActivityPage /> }]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Activity', () => {
  it('lists entries with what they moved and what they really cost', async () => {
    activityApi()
    renderRoutes(ROUTES, '/activity')
    const phm = await screen.findByRole('listitem', { name: /Project Hail Mary/ })
    expect(within(phm).getByText('$26.00')).toBeInTheDocument()
    expect(within(phm).getByText('really $18.20')).toBeInTheDocument()
    expect(within(phm).getByText('Visit, Regal, Paid with gift card')).toBeInTheDocument()

    const refund = screen.getByRole('listitem', { name: /Refund/ })
    expect(within(refund).getByText('-$7.17')).toBeInTheDocument()

    // Effective cost only shows when it differs from the amount.
    const bankVisit = screen.getByRole('listitem', { name: /How to Make a Killing/ })
    expect(within(bankVisit).queryByText(/really/)).not.toBeInTheDocument()
  })

  it('shows subscription fees, editable but never deleted', async () => {
    activityApi({
      entries: [
        { kind: 'fee', id: 1, date: '2026-01-22', chain_id: 1, description: 'Regal subscription', amount: 599, payment_source: 'gift_card', effective_cost: 419 },
        ...SCENARIO,
      ],
    })
    renderRoutes(ROUTES, '/activity')
    const fee = await screen.findByRole('listitem', { name: 'Regal subscription' })
    expect(within(fee).getByText('Fee, Regal, Paid with gift card')).toBeInTheDocument()
    expect(within(fee).getByText('really $4.19')).toBeInTheDocument()
    expect(within(fee).getByRole('link', { name: 'Edit Regal subscription' })).toHaveAttribute(
      'href',
      '/fees/1/edit',
    )
    expect(within(fee).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })

  it('labels skipped and edited months', async () => {
    const fee = { kind: 'fee' as const, chain_id: 1, description: 'Regal subscription', is_overridden: true }
    activityApi({
      entries: [
        { ...fee, id: 4, date: '2026-04-22', amount: 1299, payment_source: 'bank', effective_cost: 1299 },
        { ...fee, id: 3, date: '2026-03-22', amount: 0, payment_source: 'gift_card', effective_cost: 0 },
      ],
    })
    renderRoutes(ROUTES, '/activity')
    const march = await screen.findByRole('region', { name: 'March 2026' })
    expect(within(march).getByText('Fee, Regal, Skipped')).toBeInTheDocument()
    expect(within(march).getByText('$0.00')).toHaveClass('text-dim')
    const april = screen.getByRole('region', { name: 'April 2026' })
    expect(within(april).getByText('Fee, Regal, Paid by bank, edited')).toBeInTheDocument()
    // A bank-paid fee is cash out; the skipped one moves nothing.
    expect(within(april).getByText('Cash out $12.99')).toBeInTheDocument()
    expect(within(march).getByText('Cash out $0.00')).toBeInTheDocument()
  })

  it('shows a fee the cards could not cover at full price', async () => {
    activityApi({
      entries: [
        { kind: 'fee', id: 9, date: '2026-09-22', chain_id: 1, description: 'Regal subscription', amount: 1299, payment_source: 'gift_card', effective_cost: 1299 },
      ],
      wallets: [{ chain_id: 1, chain_name: 'Regal', balance: -2592, uncovered: 2592, runway_months: 0 }],
    })
    renderRoutes(ROUTES, '/activity')
    const fee = await screen.findByRole('listitem', { name: 'Regal subscription' })
    expect(within(fee).getByText('$12.99')).toBeInTheDocument()
    expect(within(fee).queryByText(/really/)).not.toBeInTheDocument()
    const wallets = screen.getByRole('region', { name: 'Gift card balances' })
    expect(await within(wallets).findByText('$25.92 not covered by gift card balance')).toBeInTheDocument()
    // Already short: the runway line would only repeat the warning.
    expect(within(wallets).queryByText(/next month|more month/)).not.toBeInTheDocument()
  })

  it('shows how many months of the fee the balance covers', async () => {
    const regal = { chain_id: 1, chain_name: 'Regal', balance: 2400, uncovered: 0 }
    activityApi({ wallets: [{ ...regal, runway_months: 1 }, { ...regal, chain_id: 2, chain_name: 'AMC', runway_months: 4 }] })
    renderRoutes(ROUTES, '/activity')
    expect(await screen.findByText('Covers about 1 more month')).toBeInTheDocument()
    expect(screen.getByText('Covers about 4 more months')).toBeInTheDocument()
  })

  it("warns when the balance won't cover next month's fee", async () => {
    activityApi({ wallets: [{ chain_id: 1, chain_name: 'Regal', balance: 500, uncovered: 0, runway_months: 0 }] })
    renderRoutes(ROUTES, '/activity')
    expect(await screen.findByText("Not enough for next month's fee")).toHaveClass('text-warn')
  })

  it('shows each wallet balance', async () => {
    activityApi()
    renderRoutes(ROUTES, '/activity')
    const wallets = await screen.findByRole('region', { name: 'Gift card balances' })
    expect(await within(wallets).findByText('$24.00')).toBeInTheDocument()
    expect(within(wallets).getByText('Regal')).toBeInTheDocument()
    // No gift-card-paid subscription, so no runway.
    expect(within(wallets).queryByText(/Covers about/)).not.toBeInTheDocument()
  })

  it('warns when spending is not covered by gift card balance', async () => {
    activityApi({ wallets: [{ chain_id: 1, chain_name: 'Regal', balance: -500, uncovered: 500, runway_months: null }] })
    renderRoutes(ROUTES, '/activity')
    expect(
      await screen.findByText('$5.00 not covered by gift card balance'),
    ).toBeInTheDocument()
  })

  it('groups by month with the cash that left your bank', async () => {
    activityApi()
    renderRoutes(ROUTES, '/activity')
    const feb = await screen.findByRole('region', { name: 'February 2026' })
    // Bank-paid visit $5.00 minus the $7.17 bank refund. The gift-card-paid visit isn't cash.
    expect(within(feb).getByText('Cash out -$2.17')).toBeInTheDocument()
    const jan = screen.getByRole('region', { name: 'January 2026' })
    expect(within(jan).getByText('Cash out $35.00')).toBeInTheDocument()
  })

  it('links each entry to its edit form', async () => {
    activityApi()
    renderRoutes(ROUTES, '/activity')
    await screen.findByRole('listitem', { name: /Project Hail Mary/ })
    expect(screen.getByRole('link', { name: 'Edit Project Hail Mary (+3 guests)' })).toHaveAttribute('href', '/visits/1/edit')
    expect(screen.getByRole('link', { name: 'Edit Regal gift card ($50.00 value)' })).toHaveAttribute('href', '/gift-cards/1/edit')
    expect(screen.getByRole('link', { name: 'Edit Refund' })).toHaveAttribute('href', '/credits/1/edit')
  })

  it('filters by type, keeping the filter in the URL', async () => {
    const api = activityApi()
    const router = renderRoutes(ROUTES, '/activity')
    const user = userEvent.setup()
    await screen.findByRole('listitem', { name: /Project Hail Mary/ })
    await user.selectOptions(screen.getByLabelText('Type'), 'Visits')

    expect(router.state.location.search).toBe('?kind=visit')
    expect(await screen.findByRole('listitem', { name: /How to Make a Killing/ })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: /Refund/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: /gift card/ })).not.toBeInTheDocument()
    expect(api.calls.some((c) => c.path === '/api/v1/activity')).toBe(true)
  })

  it('restores filters from the URL on reload', async () => {
    activityApi()
    renderRoutes(ROUTES, '/activity?kind=visit&month=2026-02')
    await screen.findByRole('listitem', { name: /Project Hail Mary/ })
    expect(screen.getByLabelText('Type')).toHaveValue('visit')
    expect(screen.getByLabelText('Month')).toHaveValue('2026-02')
    expect(screen.queryByRole('listitem', { name: /Refund/ })).not.toBeInTheDocument()
  })

  it('deletes after confirming, and refreshes the list and wallets without a reload', async () => {
    const api = activityApi()
    renderRoutes(ROUTES, '/activity')
    const user = userEvent.setup()
    const phm = await screen.findByRole('listitem', { name: /Project Hail Mary/ })
    await user.click(within(phm).getByRole('button', { name: 'Delete Project Hail Mary (+3 guests)' }))
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(within(phm).getByRole('button', { name: 'Yes, delete' }))

    expect(api.calls.find((c) => c.method === 'DELETE')?.path).toBe('/api/v1/visits/1')
    expect(await screen.findByText('$50.00')).toBeInTheDocument() // wallet refreshed
    expect(screen.queryByRole('listitem', { name: /Project Hail Mary/ })).not.toBeInTheDocument()
  })

  it('invites you to start logging when there is nothing yet', async () => {
    activityApi({ entries: [], wallets: [] })
    renderRoutes(ROUTES, '/activity')
    expect(await screen.findByText('Nothing logged yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log a visit' })).toHaveAttribute('href', '/visits/new')
    expect(screen.getByRole('link', { name: 'Add a gift card' })).toHaveAttribute('href', '/gift-cards/new')
  })

  it('offers to clear filters that match nothing', async () => {
    activityApi()
    const router = renderRoutes(ROUTES, '/activity?month=2025-01')
    const user = userEvent.setup()
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByRole('listitem', { name: /Project Hail Mary/ })).toBeInTheDocument()
  })
})
