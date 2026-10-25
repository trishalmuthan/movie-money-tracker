/**
 * Turns an API failure into something a form can show: a message, plus per-field
 * errors taken from FastAPI's 422 `detail[].loc` (["body", "<field>"]).
 */
export class ApiError extends Error {
  readonly status: number
  readonly fields: Record<string, string>

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
  }
}

type ValidationItem = { loc?: unknown; msg?: unknown }

export function toApiError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null | undefined)?.detail

  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {}
    const general: string[] = []
    for (const item of detail as ValidationItem[]) {
      // Pydantic prefixes model-level messages with "Value error, ".
      const message = String(item.msg ?? 'Invalid value').replace(/^Value error, /, '')
      const loc = Array.isArray(item.loc) ? item.loc : []
      const field = loc[0] === 'body' && typeof loc[1] === 'string' ? loc[1] : undefined
      if (field) fields[field] ??= message
      else general.push(message)
    }
    return new ApiError(status, general[0] ?? 'Check the highlighted fields.', fields)
  }
  if (typeof detail === 'string') return new ApiError(status, detail)
  return new ApiError(status, `The server returned an error (${status}).`)
}

/** Await an openapi-fetch call: return its data, or throw an ApiError for any non-2xx. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call
  if (!response.ok) throw toApiError(response.status, error)
  return data as T
}

/** The message to show for any error a mutation throws, including network failures. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return "Can't reach the app's server. Make sure the backend is running, then try again."
}

/**
 * Spread an error over a form's fields: API field names are renamed via `map`
 * (e.g. chain_id → chain); anything without a field becomes the `form` error.
 */
export function fieldErrors<F extends string>(
  error: unknown,
  map: Partial<Record<string, F>>,
): Partial<Record<F | 'form', string>> {
  if (!(error instanceof ApiError) || Object.keys(error.fields).length === 0) {
    return { form: errorMessage(error) } as Partial<Record<F | 'form', string>>
  }
  const result: Partial<Record<F | 'form', string>> = {}
  for (const [apiField, message] of Object.entries(error.fields)) {
    result[map[apiField] ?? 'form'] ??= message
  }
  return result
}
