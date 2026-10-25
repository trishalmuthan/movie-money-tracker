import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mockApi'
import { renderWithQuery } from '../test/render'
import { SubscriptionsSection } from './SubscriptionsSection'

type Plan = {
  id: number
  chain_id: number
  amount: number
  billing_day: number
  start_date: string
  end_date: string | null
  payment_source: string
}

const REGAL = { id: 1, name: 'Regal', standard_ticket_price: 1500 }
// The M3 reference plan.
const REFERENCE: Plan = {
  id: 1,
  chain_id: 1,
  amount: 599,
  billing_day: 22,
  start_date: '2026-01-01',
  end_date: null,
  payment_source: 'gift_card',
}

/** A fake plans API: overlaps, edited months and price changes behave like the real one. */
function plansApi(initial: Plan[] = [], { chains = [REGAL], editedMonth = '' } = {}) {
  const plans = initial.map((p) => ({ ...p }))
  let nextId = Math.max(0, ...plans.map((p) => p.id)) + 1
  const conflict = (detail: string) => ({ status: 409, body: { detail } })

  return mockApi({
    'GET /api/v1/chains': () => chains,
    'GET /api/v1/plans': () => plans,
    'POST /api/v1/plans': ({ body }) => {
      const input = body as Omit<Plan, 'id'>
      if (plans.some((p) => p.chain_id === input.chain_id && p.end_date === null)) {
        return conflict('Regal already has a subscription from 2026-01-01 with no end date, which overlaps these dates.')
      }
      const plan = { id: nextId++, ...input }
      plans.push(plan)
      return { status: 201, body: plan }
    },
    'PUT /api/v1/plans/:id': ({ params, body }) => {
      const input = body as Omit<Plan, 'id'>
      if (editedMonth && input.end_date && input.end_date < `${editedMonth}-01`) {
        return conflict('These dates would drop edited fees for August 2026. Reset those months first.')
      }
      const plan = plans.find((p) => p.id === Number(params.id))!
      Object.assign(plan, input)
      return plan
    },
    'POST /api/v1/plans/:id/change-price': ({ params, body }) => {
      const { amount, from_month } = body as { amount: number; from_month: string }
      const plan = plans.find((p) => p.id === Number(params.id))!
      const successor = { ...plan, id: nextId++, amount, start_date: `${from_month}-01` }
      plan.end_date = from_month === '2026-06' ? '2026-05-31' : 'unexpected'
      plans.push(successor)
      return { status: 201, body: successor }
    },
    'DELETE /api/v1/plans/:id': ({ params }) => {
      if (editedMonth) {
        return conflict('This plan has edited fees (August 2026). Reset them first, or end the plan instead.')
      }
      plans.splice(plans.findIndex((p) => p.id === Number(params.id)), 1)
      return { status: 204 }
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Subscriptions', () => {
  it('lists each plan period', async () => {
    plansApi([
      { ...REFERENCE, end_date: '2026-05-31' },
      { ...REFERENCE, id: 2, amount: 1299, start_date: '2026-06-01' },
    ])
    renderWithQuery(<SubscriptionsSection />)
    const [first, second] = await screen.findAllByRole('listitem')
    expect(within(first).getByText('$5.99')).toBeInTheDocument()
    expect(within(first).getByText('Regal, billed on the 22nd, paid with gift card')).toBeInTheDocument()
    expect(within(first).getByText('Jan 1, 2026 to May 31, 2026')).toBeInTheDocument()
    expect(within(second).getByText('$12.99')).toBeInTheDocument()
    expect(within(second).getByText('From Jun 1, 2026')).toBeInTheDocument()
  })

  it('adds a plan', async () => {
    const user = userEvent.setup()
    const { calls } = plansApi()
    renderWithQuery(<SubscriptionsSection />)
    await user.type(await screen.findByLabelText('Monthly price'), '5.99')
    await user.type(screen.getByLabelText('Billing day'), '22')
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-01-01' } })
    await user.click(screen.getByRole('button', { name: 'Add subscription' }))

    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      chain_id: 1,
      amount: 599,
      billing_day: 22,
      start_date: '2026-01-01',
      end_date: null,
      payment_source: 'gift_card',
    })
    expect(await screen.findByText('From Jan 1, 2026')).toBeInTheDocument()
    expect(screen.getByLabelText('Monthly price')).toHaveValue('')
  })

  it('checks the add form before sending it', async () => {
    const user = userEvent.setup()
    const { calls } = plansApi()
    renderWithQuery(<SubscriptionsSection />)
    await user.type(await screen.findByLabelText('Monthly price'), '0')
    await user.type(screen.getByLabelText('Billing day'), '29')
    await user.click(screen.getByRole('button', { name: 'Add subscription' }))
    expect(screen.getByText('Enter the monthly price, like 12.99')).toBeInTheDocument()
    expect(screen.getByText('Pick a day from 1 to 28')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('shows an overlap on the add form', async () => {
    const user = userEvent.setup()
    plansApi([REFERENCE])
    renderWithQuery(<SubscriptionsSection />)
    await user.type(await screen.findByLabelText('Monthly price'), '12.99')
    await user.type(screen.getByLabelText('Billing day'), '22')
    await user.click(screen.getByRole('button', { name: 'Add subscription' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Regal already has a subscription')
  })

  it('changes the price from a month', async () => {
    const user = userEvent.setup()
    const { calls } = plansApi([REFERENCE])
    renderWithQuery(<SubscriptionsSection />)
    await user.click(await screen.findByRole('button', { name: 'Change price' }))
    await user.type(screen.getByLabelText('New price'), '12.99')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06' } })
    await user.click(screen.getByRole('button', { name: 'Save new price' }))

    expect(calls.find((c) => c.path.endsWith('/change-price'))?.body).toEqual({
      amount: 1299,
      from_month: '2026-06',
    })
    expect(await screen.findByText('Jan 1, 2026 to May 31, 2026')).toBeInTheDocument()
    expect(screen.getByText('From Jun 1, 2026')).toBeInTheDocument()
  })

  it('ends a plan, showing a refusal on that plan', async () => {
    const user = userEvent.setup()
    const { calls } = plansApi([REFERENCE], { editedMonth: '2026-08' })
    renderWithQuery(<SubscriptionsSection />)
    await user.click(await screen.findByRole('button', { name: 'End' }))
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2026-07-31' } })
    await user.click(screen.getByRole('button', { name: 'End subscription' }))

    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ...REFERENCE, id: undefined, end_date: '2026-07-31' })
    const row = screen.getByRole('listitem')
    expect(await within(row).findByRole('alert')).toHaveTextContent('August 2026')

    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2026-09-30' } })
    await user.click(screen.getByRole('button', { name: 'End subscription' }))
    expect(await screen.findByText('Jan 1, 2026 to Sep 30, 2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End' })).not.toBeInTheDocument()
  })

  it('deletes a plan after confirming', async () => {
    const user = userEvent.setup()
    const { calls } = plansApi([REFERENCE])
    renderWithQuery(<SubscriptionsSection />)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete this subscription and its fees?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
    expect(await screen.findByText('No subscriptions yet.')).toBeInTheDocument()
  })

  it('shows why a plan with edited months cannot be deleted', async () => {
    const user = userEvent.setup()
    plansApi([REFERENCE], { editedMonth: '2026-08' })
    renderWithQuery(<SubscriptionsSection />)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(await within(screen.getByRole('listitem')).findByRole('alert')).toHaveTextContent(
      'This plan has edited fees (August 2026)',
    )
  })

  it('asks for a chain first when there are none', async () => {
    plansApi([], { chains: [] })
    renderWithQuery(<SubscriptionsSection />)
    const link = await screen.findByRole('link', { name: 'Add a theatre chain' })
    expect(link).toHaveAttribute('href', '#chains-heading')
    expect(screen.queryByRole('button', { name: 'Add subscription' })).not.toBeInTheDocument()
  })
})
