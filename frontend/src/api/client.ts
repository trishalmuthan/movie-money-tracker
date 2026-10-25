import createClient from 'openapi-fetch'
import type { paths } from './schema'

/**
 * The one typed client for the backend. Paths, bodies and responses are checked
 * against schema.d.ts, generated from FastAPI's OpenAPI schema (`npm run gen:api`).
 */
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? '',
  // Look fetch up on each call (not once at import), so tests can stub it.
  fetch: (request) => globalThis.fetch(request),
})
