import { describe, expect, it } from 'vitest'
import { ApiError, fieldErrors, toApiError } from './errors'

describe('toApiError', () => {
  it('maps FastAPI field errors and strips the "Value error, " prefix', () => {
    const error = toApiError(422, {
      detail: [
        { loc: ['body', 'date'], msg: 'Date cannot be in the future' },
        { loc: ['body'], msg: 'Value error, face_value must be at least price_paid' },
      ],
    })
    expect(error.fields).toEqual({ date: 'Date cannot be in the future' })
    expect(error.message).toBe('face_value must be at least price_paid')
  })

  it('uses a plain string detail as the message', () => {
    expect(toApiError(409, { detail: 'Already exists' }).message).toBe('Already exists')
  })
})

describe('fieldErrors', () => {
  it('renames API fields to form fields and keeps the rest as a form error', () => {
    const error = new ApiError(422, 'Fix it', { chain_id: 'Unknown chain 9', mystery: 'odd' })
    expect(fieldErrors(error, { chain_id: 'chain' })).toEqual({
      chain: 'Unknown chain 9',
      form: 'odd',
    })
  })

  it('turns a field-less API error into a form error', () => {
    expect(fieldErrors(new ApiError(409, 'Taken'), {})).toEqual({ form: 'Taken' })
  })

  it('explains a network failure', () => {
    expect(fieldErrors(new TypeError('Failed to fetch'), {}).form).toMatch(/Can't reach/)
  })
})
