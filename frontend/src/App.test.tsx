import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { renderWithQuery, stubFetchJson } from './test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('shows the API as ok when the health check succeeds', async () => {
    const fetchMock = stubFetchJson({ status: 'ok' })
    renderWithQuery(<App />)
    expect(await screen.findByText('API: ok')).toBeInTheDocument()
    const request = fetchMock.mock.calls[0][0]
    expect(new URL(request.url).pathname).toBe('/api/v1/health')
  })

  it('shows the API as down when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderWithQuery(<App />)
    expect(await screen.findByText('API: down')).toBeInTheDocument()
  })

  it('shows the API as down on a server error', async () => {
    stubFetchJson({ detail: 'boom' }, 500)
    renderWithQuery(<App />)
    expect(await screen.findByText('API: down')).toBeInTheDocument()
  })
})
