import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { unwrap } from './errors'
import { useInvalidateAll } from './invalidate'
import type { components } from './schema'

export type GiftCard = components['schemas']['GiftCardOut']
export type GiftCardInput = components['schemas']['GiftCardIn']

export function useGiftCards() {
  return useQuery({
    queryKey: ['gift-cards'],
    queryFn: () => unwrap(api.GET('/api/v1/gift-cards')),
  })
}

export function useGiftCard(id: number | undefined) {
  return useQuery({
    queryKey: ['gift-cards', id],
    queryFn: () =>
      unwrap(api.GET('/api/v1/gift-cards/{load_id}', { params: { path: { load_id: id! } } })),
    enabled: id !== undefined,
  })
}

export function useSaveGiftCard(id: number | undefined) {
  const onSuccess = useInvalidateAll()
  return useMutation({
    mutationFn: (body: GiftCardInput) =>
      id === undefined
        ? unwrap(api.POST('/api/v1/gift-cards', { body }))
        : unwrap(
            api.PUT('/api/v1/gift-cards/{load_id}', { params: { path: { load_id: id } }, body }),
          ),
    onSuccess,
  })
}
