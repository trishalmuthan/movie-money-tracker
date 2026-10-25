import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'

/**
 * Render `routes` at `path` with a fresh QueryClient. "/" is a stub Activity page,
 * so a test can see that saving navigated back there.
 */
export function renderRoutes(routes: RouteObject[], path: string) {
  const router = createMemoryRouter(
    [{ path: '/', element: <h1>Activity page</h1> }, ...routes],
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
