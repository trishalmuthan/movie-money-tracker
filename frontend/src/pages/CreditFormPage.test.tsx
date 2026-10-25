import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mockApi'
import { renderRoutes } from '../test/renderRoutes'
import { CreditFormPage } from './CreditFormPage'

const CHAINS = [
  { id: 1, name: 'Cinemark', standard_ticket_price: 1400 },
  { id: 2, name: 'Regal', standard_ticket_price: 1500 },
]
const REFUND = {
  id: 3,
  date: '2025-05-27',
  chain_id: 1,
  amount: 717,
  destination: 'bank',
  note: 'Mission Impossible refund',
}

const ROUTES = [
  { path: '/credits/new', element: <CreditFormPage mode="new" /> },
  { path: '/credits/:id/edit', element: <CreditFormPage mode="edit" /> },
]

function creditsApi() {
  return mockApi({
    'GET /api/v1/chains': () => CHAINS,
    'GET /api/v1/credits/:id': ({ params }) =>
      Number(params.id) === REFUND.id ? REFUND : { status: 404, body: { detail: 'nope' } },
    'POST /api/v1/credits': ({ body }) => ({ status: 201, body: { id: 9, ...(body as object) } }),
    'PUT /api/v1/credits/:id': ({ params, body }) => ({ id: Number(params.id), ...(body as object) }),
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 20, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Add a refund', () => {
  it('explains that refunds lower your spending', async () => {
    creditsApi()
    renderRoutes(ROUTES, '/credits/new')
    expect(await screen.findByText(/lowers what you've spent/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Bank' })).toBeChecked()
  })

  it('saves a bank refund without a chain', async () => {
    const api = creditsApi()
    const router = renderRoutes(ROUTES, '/credits/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Amount'), '7.17')
    await user.click(screen.getByRole('button', { name: 'Save refund' }))

    await screen.findByRole('heading', { name: 'Activity page' })
    expect(router.state.location.pathname).toBe('/')
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      date: '2026-10-15',
      chain_id: null,
      amount: 717,
      destination: 'bank',
      note: null,
    })
  })

  it('needs a chain for a refund onto a gift card', async () => {
    const api = creditsApi()
    renderRoutes(ROUTES, '/credits/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Amount'), '7.17')
    await user.click(screen.getByRole('radio', { name: 'Gift card' }))
    await user.click(screen.getByRole('button', { name: 'Save refund' }))

    expect(screen.getByText('Choose whose gift card got the money')).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)

    await user.selectOptions(screen.getByLabelText('Chain'), 'Regal')
    await user.click(screen.getByRole('button', { name: 'Save refund' }))
    await screen.findByRole('heading', { name: 'Activity page' })
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      chain_id: 2,
      destination: 'gift_card',
    })
  })

  it('asks for a positive amount, even if you type it as negative like the sheet did', async () => {
    const api = creditsApi()
    renderRoutes(ROUTES, '/credits/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Amount'), '-7.17')
    await user.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(screen.getByText('Enter the amount you got back as a positive number')).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('edits an existing refund', async () => {
    const api = creditsApi()
    renderRoutes(ROUTES, '/credits/3/edit')
    const user = userEvent.setup()
    const amount = await screen.findByDisplayValue('7.17')
    expect(screen.getByLabelText('Chain')).toHaveValue('1')
    await user.clear(amount)
    await user.type(amount, '7.00')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByRole('heading', { name: 'Activity page' })
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/v1/credits/3',
      body: { amount: 700, chain_id: 1, destination: 'bank', note: 'Mission Impossible refund' },
    })
  })

  it('says so when the refund to edit does not exist', async () => {
    creditsApi()
    renderRoutes(ROUTES, '/credits/404/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent("This refund doesn't exist")
  })
})
