import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { unwrap } from './errors'
import { useInvalidateAll } from './invalidate'
import type { components } from './schema'

export type Plan = components['schemas']['PlanOut']
export type PlanInput = components['schemas']['PlanIn']

export function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: () => unwrap(api.GET('/api/v1/plans')),
  })
}

export function useCreatePlan() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (body: PlanInput) => unwrap(api.POST('/api/v1/plans', { body })),
    onSuccess,
  })
}

/** Ending a plan is an edit: the same plan with an end date. */
export function useUpdatePlan() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PlanInput }) =>
      unwrap(api.PUT('/api/v1/plans/{plan_id}', { params: { path: { plan_id: id } }, body })),
    onSuccess,
  })
}

export function useChangePrice() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, amount, fromMonth }: { id: number; amount: number; fromMonth: string }) =>
      unwrap(
        api.POST('/api/v1/plans/{plan_id}/change-price', {
          params: { path: { plan_id: id } },
          body: { amount, from_month: fromMonth },
        }),
      ),
    onSuccess,
  })
}

export function useDeletePlan() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.DELETE('/api/v1/plans/{plan_id}', { params: { path: { plan_id: id } } })),
    onSuccess,
  })
}
