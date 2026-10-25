import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mockApi'
import { renderWithQuery } from '../test/render'
import { SettingsPage } from './SettingsPage'

type Chain = { id: number; name: string; standard_ticket_price: number }

/** A fake chains API backed by an in-memory list, behaving like the real one. */
function chainsApi(initial: Chain[] = [], { inUse = [] as number[] } = {}) {
  const chains = initial.map((c) => ({ ...c })) // copies, so edits never leak between tests
  let nextId = Math.max(0, ...chains.map((c) => c.id)) + 1
  const taken = (name: string, except?: number) =>
    chains.some((c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase())

  return mockApi({
    'GET /api/v1/health': () => ({ status: 'ok' }),
    'GET /api/v1/chains': () => [...chains].sort((a, b) => a.name.localeCompare(b.name)),
    'POST /api/v1/chains': ({ body }) => {
      const input = body as Omit<Chain, 'id'>
      if (taken(input.name)) {
        return { status: 409, body: { detail: `A chain named '${input.name}' already exists` } }
      }
      const chain = { id: nextId++, ...input }
      chains.push(chain)
      return { status: 201, body: chain }
    },
    'PUT /api/v1/chains/:id': ({ params, body }) => {
      const id = Number(params.id)
      const input = body as Omit<Chain, 'id'>
      if (taken(input.name, id)) {
        return { status: 409, body: { detail: `A chain named '${input.name}' already exists` } }
      }
      const chain = chains.find((c) => c.id === id)!
      Object.assign(chain, input)
      return chain
    },
    'DELETE /api/v1/chains/:id': ({ params }) => {
      const id = Number(params.id)
      if (inUse.includes(id)) {
        return {
          status: 409,
          body: { detail: 'This chain still has entries. Delete or move them first.' },
        }
      }
      chains.splice(
        chains.findIndex((c) => c.id === id),
        1,
      )
      return { status: 204 }
    },
  })
}

const REGAL: Chain = { id: 1, name: 'Regal', standard_ticket_price: 1500 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Settings → chains', () => {
  it('invites you to add a first chain when there are none', async () => {
    chainsApi()
    renderWithQuery(<SettingsPage />)
    expect(await screen.findByText(/No chains yet/)).toBeInTheDocument()
  })

  it('lists chains with their ticket price in dollars', async () => {
    chainsApi([REGAL])
    renderWithQuery(<SettingsPage />)
    const row = await screen.findByRole('listitem', { name: 'Regal' })
    expect(within(row).getByText('$15.00')).toBeInTheDocument()
  })

  it('adds a chain, storing the price in cents', async () => {
    const api = chainsApi()
    renderWithQuery(<SettingsPage />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Chain name'), 'Regal')
    await user.type(screen.getByLabelText('Ticket price'), '15.00')
    await user.click(screen.getByRole('button', { name: 'Add chain' }))

    expect(await screen.findByRole('listitem', { name: 'Regal' })).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Regal',
      standard_ticket_price: 1500,
    })
    expect(screen.getByLabelText('Chain name')).toHaveValue('')
  })

  it('rejects a price that is not a dollar amount, without calling the API', async () => {
    const api = chainsApi()
    renderWithQuery(<SettingsPage />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Chain name'), 'Regal')
    await user.type(screen.getByLabelText('Ticket price'), '15.5.0')
    await user.click(screen.getByRole('button', { name: 'Add chain' }))

    expect(await screen.findByText('Enter an amount like 15.00')).toBeInTheDocument()
    expect(screen.getByLabelText('Ticket price')).toHaveAttribute('aria-invalid', 'true')
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('shows a duplicate name on the name field', async () => {
    chainsApi([REGAL])
    renderWithQuery(<SettingsPage />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Chain name'), 'regal')
    await user.type(screen.getByLabelText('Ticket price'), '15')
    await user.click(screen.getByRole('button', { name: 'Add chain' }))

    expect(await screen.findByText("A chain named 'regal' already exists")).toBeInTheDocument()
    expect(screen.getByLabelText('Chain name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('edits a chain in place', async () => {
    const api = chainsApi([REGAL])
    renderWithQuery(<SettingsPage />)
    const user = userEvent.setup()
    const row = await screen.findByRole('listitem', { name: 'Regal' })
    await user.click(within(row).getByRole('button', { name: 'Edit Regal' }))

    const price = within(row).getByLabelText('Ticket price')
    expect(price).toHaveValue('15.00')
    await user.clear(price)
    await user.type(price, '16.50')
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    expect(await within(row).findByText('$16.50')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/v1/chains/1',
      body: { name: 'Regal', standard_ticket_price: 1650 },
    })
  })

  it('cancels an edit without saving', async () => {
    const api = chainsApi([REGAL])
    renderWithQuery(<SettingsPage />)
    const user = userEvent.setup()
    const row = await screen.findByRole('listitem', { name: 'Regal' })
    await user.click(within(row).getByRole('button', { name: 'Edit Regal' }))
    await user.click(within(row).getByRole('button', { name: 'Cancel' }))
    expect(within(row).getByText('$15.00')).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('deletes an unused chain after confirming', async () => {
    const api = chainsApi([REGAL])
    renderWithQuery(<SettingsPage />)
    const user = userEvent.setup()
    const row = await screen.findByRole('listitem', { name: 'Regal' })
    await user.click(within(row).getByRole('button', { name: 'Delete Regal' }))
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(within(row).getByRole('button', { name: 'Yes, delete' }))

    expect(await screen.findByText(/No chains yet/)).toBeInTheDocument()
  })

  it('keeps a chain that still has entries and says why', async () => {
    chainsApi([REGAL], { inUse: [1] })
    renderWithQuery(<SettingsPage />)
    const user = userEvent.setup()
    const row = await screen.findByRole('listitem', { name: 'Regal' })
    await user.click(within(row).getByRole('button', { name: 'Delete Regal' }))
    await user.click(within(row).getByRole('button', { name: 'Yes, delete' }))

    expect(await within(row).findByRole('alert')).toHaveTextContent('still has entries')
    expect(screen.getByRole('listitem', { name: 'Regal' })).toBeInTheDocument()
  })
})
