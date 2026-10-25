import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mockApi'
import { routes } from './router'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  mockApi({
    'GET /api/v1/health': () => ({ status: 'ok' }),
    'GET /api/v1/chains': () => [],
    'GET /api/v1/visits': () => [],
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('routes', () => {
  it.each([
    ['/', 'Activity'],
    ['/visits/new', 'Log a visit'],
    ['/visits/3/edit', 'Edit visit'],
    ['/gift-cards/new', 'Add a gift card'],
    ['/gift-cards/3/edit', 'Edit gift card'],
    ['/credits/new', 'Add a refund'],
    ['/credits/3/edit', 'Edit refund'],
    ['/settings', 'Settings'],
  ])('%s shows the %s page', async (path, heading) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
  })

  it('shows a not-found page with a way back for unknown paths', async () => {
    renderAt('/films/42')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Activity' })).toHaveAttribute('href', '/')
  })
})

describe('navigation', () => {
  it('marks the current page in the main navigation', async () => {
    renderAt('/settings')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Activity' })).not.toHaveAttribute('aria-current')
  })

  it('offers logging a visit from every page', async () => {
    renderAt('/settings')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Log visit' })).toHaveAttribute('href', '/visits/new')
  })

  it('links every section', async () => {
    renderAt('/')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(['/', '/visits/new', '/gift-cards/new', '/credits/new', '/settings'])
  })
})

describe('API status', () => {
  it('stays quiet while the API is up', async () => {
    renderAt('/')
    await screen.findByRole('heading', { level: 1, name: 'Activity' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderAt('/')
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the app's server")
  })
})
