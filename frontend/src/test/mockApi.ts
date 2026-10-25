import { vi } from 'vitest'

type Reply = { status?: number; body?: unknown }
type Handler = (request: {
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
}) => Reply | unknown

/**
 * Stub fetch with a tiny fake API. Keys are "METHOD /path", where path segments like
 * ":id" match anything. A handler returns either a Reply ({status, body}) or a plain
 * body (status 200). Unmatched requests fail the test loudly with a 599.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const routes = Object.entries(handlers).map(([key, handler]) => {
    const [method, pattern] = key.split(' ')
    return { method, parts: pattern.split('/'), handler }
  })

  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    const text = await request.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    calls.push({ method: request.method, path: url.pathname, body })

    const parts = url.pathname.split('/')
    for (const route of routes) {
      if (route.method !== request.method || route.parts.length !== parts.length) continue
      const params: Record<string, string> = {}
      const matches = route.parts.every((part, i) => {
        if (part.startsWith(':')) {
          params[part.slice(1)] = parts[i]
          return true
        }
        return part === parts[i]
      })
      if (!matches) continue
      const result = route.handler({ params, query: url.searchParams, body })
      const reply: Reply =
        result !== null && typeof result === 'object' && ('status' in result || 'body' in result)
          ? (result as Reply)
          : { body: result }
      const status = reply.status ?? 200
      if (status === 204) return new Response(null, { status })
      return Response.json(reply.body ?? null, { status })
    }
    return Response.json({ detail: `No mock for ${request.method} ${url.pathname}` }, { status: 599 })
  })

  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}
