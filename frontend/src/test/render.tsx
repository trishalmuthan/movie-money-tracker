import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'

/** Render inside a fresh QueryClient (no retries, so failures show immediately). */
export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Stub fetch so every request answers with `body` as JSON. */
export function stubFetchJson(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_request: Request) =>
    Response.json(body, { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
