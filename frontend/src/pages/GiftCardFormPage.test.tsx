import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mockApi'
import { renderRoutes } from '../test/renderRoutes'
import { GiftCardFormPage } from './GiftCardFormPage'

const CHAINS = [
  { id: 1, name: 'Cinemark', standard_ticket_price: 1400 },
  { id: 2, name: 'Regal', standard_ticket_price: 1500 },
]
const CARD = { id: 4, chain_id: 2, date: '2026-04-26', price_paid: 3999, face_value: 5000, note: null }

const ROUTES = [
  { path: '/gift-cards/new', element: <GiftCardFormPage mode="new" /> },
  { path: '/gift-cards/:id/edit', element: <GiftCardFormPage mode="edit" /> },
]

function giftCardsApi({ cards = [CARD], onPost = (body: unknown): unknown => ({ status: 201, body: { id: 9, ...(body as object) } }) } = {}) {
  return mockApi({
    'GET /api/v1/chains': () => CHAINS,
    'GET /api/v1/gift-cards': () => cards,
    'GET /api/v1/gift-cards/:id': ({ params }) =>
      cards.find((c) => c.id === Number(params.id)) ?? { status: 404, body: { detail: 'nope' } },
    'POST /api/v1/gift-cards': ({ body }) => onPost(body),
    'PUT /api/v1/gift-cards/:id': ({ params, body }) => ({ id: Number(params.id), ...(body as object) }),
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

describe('Add a gift card', () => {
  it('defaults to today and the chain of your latest gift card', async () => {
    giftCardsApi()
    renderRoutes(ROUTES, '/gift-cards/new')
    expect(await screen.findByLabelText('Chain')).toHaveValue('2')
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-15')
  })

  it('shows the discount live as you type', async () => {
    giftCardsApi()
    renderRoutes(ROUTES, '/gift-cards/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('You paid'), '35')
    await user.type(screen.getByLabelText('Card value'), '50')
    expect(screen.getByText('30% off')).toBeInTheDocument()
    expect(screen.getByText('$15.00 of extra balance')).toBeInTheDocument()
  })

  it('says when there is no discount', async () => {
    giftCardsApi()
    renderRoutes(ROUTES, '/gift-cards/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('You paid'), '50')
    await user.type(screen.getByLabelText('Card value'), '50')
    expect(screen.getByText('No discount')).toBeInTheDocument()
  })

  it('saves in cents and returns to Activity', async () => {
    const api = giftCardsApi()
    const router = renderRoutes(ROUTES, '/gift-cards/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('You paid'), '35.00')
    await user.type(screen.getByLabelText('Card value'), '$50')
    await user.type(screen.getByLabelText('Note (optional)'), 'Costco')
    await user.click(screen.getByRole('button', { name: 'Save gift card' }))

    expect(await screen.findByRole('heading', { name: 'Activity page' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      chain_id: 2,
      date: '2026-10-15',
      price_paid: 3500,
      face_value: 5000,
      note: 'Costco',
    })
  })

  it('blocks a card value below what you paid', async () => {
    const api = giftCardsApi()
    renderRoutes(ROUTES, '/gift-cards/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('You paid'), '50')
    await user.type(screen.getByLabelText('Card value'), '35')
    // Visible before submitting...
    expect(screen.getByText("The card's value is less than you paid")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save gift card' }))
    // ...and blocks the save.
    expect(screen.getByLabelText('Card value')).toHaveAttribute('aria-invalid', 'true')
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('requires both amounts', async () => {
    const api = giftCardsApi()
    renderRoutes(ROUTES, '/gift-cards/new')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save gift card' }))
    expect(screen.getByText('Enter what you paid, like 35.00')).toBeInTheDocument()
    expect(screen.getByText("Enter the card's value, like 50.00")).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it("shows the server's face-value error on the card value field", async () => {
    giftCardsApi({
      onPost: () => ({
        status: 422,
        body: { detail: [{ loc: ['body', 'face_value'], msg: 'Input should be greater than 0' }] },
      }),
    })
    renderRoutes(ROUTES, '/gift-cards/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('You paid'), '35')
    await user.type(screen.getByLabelText('Card value'), '50')
    await user.click(screen.getByRole('button', { name: 'Save gift card' }))
    expect(await screen.findByText('Input should be greater than 0')).toBeInTheDocument()
    expect(screen.getByLabelText('Card value')).toHaveAttribute('aria-invalid', 'true')
  })

  it('edits an existing gift card', async () => {
    const api = giftCardsApi()
    renderRoutes(ROUTES, '/gift-cards/4/edit')
    const user = userEvent.setup()
    const paid = await screen.findByDisplayValue('39.99')
    expect(screen.getByLabelText('Card value')).toHaveValue('50.00')
    expect(screen.getByText('20% off')).toBeInTheDocument()
    await user.clear(paid)
    await user.type(paid, '37.50')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByRole('heading', { name: 'Activity page' })
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/v1/gift-cards/4',
      body: { price_paid: 3750, face_value: 5000, date: '2026-04-26', chain_id: 2 },
    })
  })
})
