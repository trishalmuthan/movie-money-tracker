import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mockApi'
import { renderRoutes } from '../test/renderRoutes'
import { FeeFormPage } from './FeeFormPage'

// March of the M3 reference plan: Regal $5.99 on the 22nd, paid from gift card.
const MARCH = {
  id: 3,
  plan_id: 1,
  chain_id: 1,
  month: '2026-03',
  date: '2026-03-22',
  amount: 599,
  payment_source: 'gift_card',
  is_overridden: false,
}

const ROUTES = [{ path: '/fees/:id/edit', element: <FeeFormPage /> }]

function feesApi(fee = MARCH) {
  return mockApi({
    'GET /api/v1/chains': () => [{ id: 1, name: 'Regal', standard_ticket_price: 1500 }],
    'GET /api/v1/fees/:id': ({ params }) =>
      Number(params.id) === fee.id ? fee : { status: 404, body: { detail: 'FeeCharge 9 not found' } },
    'PUT /api/v1/fees/:id': ({ body }) => ({ ...fee, ...(body as object), is_overridden: true }),
    'POST /api/v1/fees/:id/reset': () => ({ ...fee, amount: 599, payment_source: 'gift_card', is_overridden: false }),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Edit a fee', () => {
  it("shows the month's fee and how to skip it", async () => {
    feesApi()
    renderRoutes(ROUTES, '/fees/3/edit')
    expect(await screen.findByText('Regal subscription for March 2026, billed Mar 22.')).toBeInTheDocument()
    expect(screen.getByLabelText('Amount')).toHaveValue('5.99')
    expect(screen.getByRole('radio', { name: 'Gift card' })).toBeChecked()
    expect(screen.getByText(/\$0\.00 for a month you skipped/)).toBeInTheDocument()
    // Nothing to reset until the month has been edited.
    expect(screen.queryByRole('button', { name: 'Reset to plan' })).not.toBeInTheDocument()
  })

  it('saves a skipped month as $0 and returns to Activity', async () => {
    const api = feesApi()
    const router = renderRoutes(ROUTES, '/fees/3/edit')
    const user = userEvent.setup()
    const amount = await screen.findByLabelText('Amount')
    await user.clear(amount)
    await user.type(amount, '0')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByRole('heading', { name: 'Activity page' })
    expect(router.state.location.pathname).toBe('/')
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ amount: 0, payment_source: 'gift_card' })
  })

  it('switches a month to bank', async () => {
    const api = feesApi()
    renderRoutes(ROUTES, '/fees/3/edit')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Bank' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('heading', { name: 'Activity page' })
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ amount: 599, payment_source: 'bank' })
  })

  it('rejects an amount it cannot read', async () => {
    const api = feesApi()
    renderRoutes(ROUTES, '/fees/3/edit')
    const user = userEvent.setup()
    const amount = await screen.findByLabelText('Amount')
    await user.clear(amount)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('Enter an amount like 12.99, or 0 for a skipped month')).toBeInTheDocument()
    await user.type(amount, '-1')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('Enter an amount like 12.99, or 0 for a skipped month')).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('resets an edited month to its plan', async () => {
    const api = feesApi({ ...MARCH, amount: 0, payment_source: 'bank', is_overridden: true })
    const router = renderRoutes(ROUTES, '/fees/3/edit')
    const user = userEvent.setup()
    expect(await screen.findByText(/You've edited this month/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset to plan' }))
    await screen.findByRole('heading', { name: 'Activity page' })
    expect(router.state.location.pathname).toBe('/')
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/fees/3/reset')).toBe(true)
  })

  it("explains a fee that doesn't exist", async () => {
    feesApi()
    renderRoutes(ROUTES, '/fees/9/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent("This fee doesn't exist")
  })
})
