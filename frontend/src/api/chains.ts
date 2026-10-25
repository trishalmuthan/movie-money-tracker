import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { unwrap } from './errors'
import { useInvalidateAll } from './invalidate'
import type { components } from './schema'

export type Chain = components['schemas']['ChainOut']
export type ChainInput = components['schemas']['ChainIn']

export function useChains() {
  return useQuery({
    queryKey: ['chains'],
    queryFn: () => unwrap(api.GET('/api/v1/chains')),
  })
}


export function useCreateChain() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (body: ChainInput) => unwrap(api.POST('/api/v1/chains', { body })),
    onSuccess,
  })
}

export function useUpdateChain() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ChainInput }) =>
      unwrap(api.PUT('/api/v1/chains/{chain_id}', { params: { path: { chain_id: id } }, body })),
    onSuccess,
  })
}

export function useDeleteChain() {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.DELETE('/api/v1/chains/{chain_id}', { params: { path: { chain_id: id } } })),
    onSuccess,
  })
}
