import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { unwrap } from './errors'
import { useInvalidateAll } from './invalidate'
import type { components } from './schema'

export type EntryKind = components['schemas']['EntryKind']
export type Wallet = components['schemas']['WalletOut']
export type ActivityFilters = { kind?: EntryKind; chainId?: number; month?: string }

export function useActivity(filters: ActivityFilters) {
  return useQuery({
    queryKey: ['activity', filters],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/activity', {
          params: {
            query: { kind: filters.kind, chain_id: filters.chainId, month: filters.month },
          },
        }),
      ),
  })
}

export function useWallets() {
  return useQuery({
    queryKey: ['wallets'],
    queryFn: () => unwrap(api.GET('/api/v1/wallets')),
  })
}

/** Delete an activity entry through its own resource's endpoint. Fees are edited, never deleted. */
export function useDeleteEntry() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: ({ kind, id }: { kind: Exclude<EntryKind, 'fee'>; id: number }) => {
      switch (kind) {
        case 'visit':
          return unwrap(api.DELETE('/api/v1/visits/{visit_id}', { params: { path: { visit_id: id } } }))
        case 'gift_card':
          return unwrap(api.DELETE('/api/v1/gift-cards/{load_id}', { params: { path: { load_id: id } } }))
        case 'credit':
          return unwrap(api.DELETE('/api/v1/credits/{credit_id}', { params: { path: { credit_id: id } } }))
      }
    },
    onSuccess,
  })
}
