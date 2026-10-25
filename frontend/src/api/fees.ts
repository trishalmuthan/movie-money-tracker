import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { unwrap } from './errors'
import { useInvalidateAll } from './invalidate'
import type { components } from './schema'

export type Fee = components['schemas']['FeeOut']
export type FeeInput = components['schemas']['FeeIn']

export function useFee(id: number) {
  return useQuery({
    queryKey: ['fees', id],
    queryFn: () => unwrap(api.GET('/api/v1/fees/{fee_id}', { params: { path: { fee_id: id } } })),
  })
}

/** Saving marks the month as edited: the plan stops updating it. */
export function useSaveFee(id: number) {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (body: FeeInput) =>
      unwrap(api.PUT('/api/v1/fees/{fee_id}', { params: { path: { fee_id: id } }, body })),
    onSuccess,
  })
}

/** Hand the month back to its plan's price and payment. */
export function useResetFee(id: number) {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST('/api/v1/fees/{fee_id}/reset', { params: { path: { fee_id: id } } })),
    onSuccess,
  })
}
