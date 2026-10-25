import { useQueryClient } from '@tanstack/react-query'

/**
 * Any saved change can move balances, effective costs and lists elsewhere in the app,
 * so mutations refresh every cached query. Cheap at personal scale, and never stale.
 */
export function useInvalidateAll() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries()
}
