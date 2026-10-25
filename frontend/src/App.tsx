import { useQuery } from '@tanstack/react-query'
import { api } from './api/client'

function useApiStatus(): 'checking' | 'ok' | 'down' {
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

export default function App() {
  const status = useApiStatus()
  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-2xl font-semibold">Movie Money Tracker</h1>
      <p className="mt-2 text-sm text-neutral-400">API: {status}</p>
    </main>
  )
}
