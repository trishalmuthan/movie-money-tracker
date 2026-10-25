import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mockApi'
import { VisitFormPage } from './VisitFormPage'

const CHAINS = [
  { id: 1, name: 'Cinemark', standard_ticket_price: 1400 },
  { id: 2, name: 'Regal', standard_ticket_price: 1500 },
]
const PHM = {
  id: 7,
  date: '2026-02-15',
  chain_id: 2,
  title: 'Project Hail Mary',
  my_cost: 650,
  guest_count: 3,
  guest_cost: 1950,
  payment_source: 'gift_card',
  note: null,
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <h1>Activity page</h1> },
      { path: '/visits/new', element: <VisitFormPage mode="new" /> },
      { path: '/visits/:id/edit', element: <VisitFormPage mode="edit" /> },
    ],
    { initialEntries: [path] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

function visitsApi({
  chains = CHAINS,
  visits = [PHM],
  onPost = (body: unknown): unknown => ({ status: 201, body: { id: 99, ...(body as object) } }),
} = {}) {
  return mockApi({
    'GET /api/v1/chains': () => chains,
    'GET /api/v1/visits': () => visits,
    'GET /api/v1/visits/:id': ({ params }) =>
      visits.find((v) => v.id === Number(params.id)) ?? { status: 404, body: { detail: 'nope' } },
    'POST /api/v1/visits': ({ body }) => onPost(body),
    'PUT /api/v1/visits/:id': ({ params, body }) => ({ id: Number(params.id), ...(body as object) }),
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 23, 30)) // 11:30 pm local on Oct 15
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Log a visit', () => {
  it('starts with sensible defaults', async () => {
    visitsApi()
    renderAt('/visits/new')
    expect(await screen.findByLabelText('Date')).toHaveValue('2026-10-15')
    // Defaults to the chain of your most recent visit.
    expect(await screen.findByLabelText('Chain')).toHaveValue('2')
    expect(screen.getByLabelText('My ticket')).toHaveValue('0.00')
    expect(screen.getByLabelText('Guests')).toHaveValue(0)
    expect(screen.getByRole('radio', { name: 'Free' })).toBeChecked()
  })

  it('saves a free visit and returns to Activity', async () => {
    const api = visitsApi()
    const router = renderAt('/visits/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Film'), 'Send Help')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    expect(await screen.findByRole('heading', { name: 'Activity page' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      date: '2026-10-15',
      chain_id: 2,
      title: 'Send Help',
      my_cost: 0,
      guest_count: 0,
      guest_cost: 0,
      payment_source: 'free',
      note: null,
    })
  })

  it('switches from free to gift card once there is a cost', async () => {
    visitsApi()
    renderAt('/visits/new')
    const user = userEvent.setup()
    const myCost = await screen.findByLabelText('My ticket')
    await user.clear(myCost)
    await user.type(myCost, '0.50')
    expect(screen.getByRole('radio', { name: 'Gift card' })).toBeChecked()
    await user.clear(myCost)
    await user.type(myCost, '0')
    expect(screen.getByRole('radio', { name: 'Free' })).toBeChecked()
  })

  it('keeps a payment source you picked yourself', async () => {
    visitsApi()
    renderAt('/visits/new')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Bank' }))
    const myCost = screen.getByLabelText('My ticket')
    await user.clear(myCost)
    await user.type(myCost, '5')
    expect(screen.getByRole('radio', { name: 'Bank' })).toBeChecked()
  })

  it('records guests and what they cost', async () => {
    const api = visitsApi()
    renderAt('/visits/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Film'), 'Project Hail Mary')
    await user.clear(screen.getByLabelText('My ticket'))
    await user.type(screen.getByLabelText('My ticket'), '6.50')
    await user.clear(screen.getByLabelText('Guests'))
    await user.type(screen.getByLabelText('Guests'), '3')
    await user.clear(screen.getByLabelText('Guest tickets'))
    await user.type(screen.getByLabelText('Guest tickets'), '19.50')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    await screen.findByRole('heading', { name: 'Activity page' })
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      my_cost: 650,
      guest_count: 3,
      guest_cost: 1950,
      payment_source: 'gift_card',
    })
  })

  it('asks for guests when there is a guest cost', async () => {
    const api = visitsApi()
    renderAt('/visits/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Film'), 'Odyssey')
    await user.clear(screen.getByLabelText('Guest tickets'))
    await user.type(screen.getByLabelText('Guest tickets'), '13')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    expect(await screen.findByText('Enter how many guests')).toBeInTheDocument()
    expect(screen.getByLabelText('Guests')).toHaveAttribute('aria-invalid', 'true')
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('rejects dollar text it cannot read and a missing film', async () => {
    const api = visitsApi()
    renderAt('/visits/new')
    const user = userEvent.setup()
    const myCost = await screen.findByLabelText('My ticket')
    await user.clear(myCost)
    await user.type(myCost, '1.234')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    expect(await screen.findByText('Enter an amount like 6.50')).toBeInTheDocument()
    expect(screen.getByText('Enter the film')).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('shows a server-side date error on the date field', async () => {
    visitsApi({
      onPost: () => ({
        status: 422,
        body: {
          detail: [
            { type: 'value_error', loc: ['body', 'date'], msg: 'Date cannot be in the future' },
          ],
        },
      }),
    })
    renderAt('/visits/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Film'), 'Send Help')
    await user.click(screen.getByRole('button', { name: 'Save visit' }))

    expect(await screen.findByText('Date cannot be in the future')).toBeInTheDocument()
    expect(screen.getByLabelText('Date')).toHaveAttribute('aria-invalid', 'true')
  })

  it('edits an existing visit', async () => {
    const api = visitsApi()
    renderAt('/visits/7/edit')
    const user = userEvent.setup()
    const film = await screen.findByDisplayValue('Project Hail Mary')
    expect(screen.getByLabelText('Date')).toHaveValue('2026-02-15')
    expect(screen.getByLabelText('Guest tickets')).toHaveValue('19.50')
    expect(screen.getByRole('radio', { name: 'Gift card' })).toBeChecked()

    await user.type(film, ' (IMAX)')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByRole('heading', { name: 'Activity page' })
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/v1/visits/7',
      body: { title: 'Project Hail Mary (IMAX)', my_cost: 650, guest_cost: 1950 },
    })
  })

  it('points you to Settings when there are no chains yet', async () => {
    visitsApi({ chains: [], visits: [] })
    renderAt('/visits/new')
    expect(await screen.findByRole('link', { name: 'Add a chain in Settings' })).toHaveAttribute(
      'href',
      '/settings',
    )
    expect(screen.queryByRole('button', { name: 'Save visit' })).not.toBeInTheDocument()
  })

  it('says so when the visit to edit does not exist', async () => {
    visitsApi()
    renderAt('/visits/404/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent("This visit doesn't exist")
  })
})
