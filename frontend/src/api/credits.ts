import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { unwrap } from './errors'
import { useInvalidateAll } from './invalidate'
import type { components } from './schema'

// The API calls these credits; the app shows them as refunds.
export type Credit = components['schemas']['CreditOut']
export type CreditInput = components['schemas']['CreditIn']
export type CreditDestination = components['schemas']['CreditDestination']

export function useCredit(id: number | undefined) {
  return useQuery({
    queryKey: ['credits', id],
    queryFn: () =>
      unwrap(api.GET('/api/v1/credits/{credit_id}', { params: { path: { credit_id: id! } } })),
    enabled: id !== undefined,
  })
}

export function useSaveCredit(id: number | undefined) {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (body: CreditInput) =>
      id === undefined
        ? unwrap(api.POST('/api/v1/credits', { body }))
        : unwrap(
            api.PUT('/api/v1/credits/{credit_id}', { params: { path: { credit_id: id } }, body }),
          ),
    onSuccess,
  })
}
