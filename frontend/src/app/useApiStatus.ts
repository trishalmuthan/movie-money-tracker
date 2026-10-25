import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export type ApiStatus = 'checking' | 'ok' | 'down'

export function useApiStatus(): ApiStatus {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/health')
      if (error !== undefined || data === undefined) throw new Error('health check failed')
      return data
    },
  })
  if (health.isPending) return 'checking'
  return health.data?.status === 'ok' ? 'ok' : 'down'
}
