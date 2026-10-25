import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { unwrap } from './errors'
import type { components } from './schema'

export type Visit = components['schemas']['VisitOut']
export type VisitInput = components['schemas']['VisitIn']
export type PaymentSource = components['schemas']['PaymentSource']

export function useVisits() {
  return useQuery({
    queryKey: ['visits'],
    queryFn: () => unwrap(api.GET('/api/v1/visits')),
  })
}

export function useVisit(id: number | undefined) {
  return useQuery({
    queryKey: ['visits', id],
    queryFn: () =>
      unwrap(api.GET('/api/v1/visits/{visit_id}', { params: { path: { visit_id: id! } } })),
    enabled: id !== undefined,
  })
}

/** A visit changes activity, wallets and effective costs, so refresh everything. */
function useInvalidateAll() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries()
}

export function useSaveVisit(id: number | undefined) {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (body: VisitInput) =>
      id === undefined
        ? unwrap(api.POST('/api/v1/visits', { body }))
        : unwrap(
            api.PUT('/api/v1/visits/{visit_id}', { params: { path: { visit_id: id } }, body }),
          ),
    onSuccess,
  })
}
