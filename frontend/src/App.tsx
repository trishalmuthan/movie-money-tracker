import { useEffect, useState } from 'react'

type ApiStatus = 'checking' | 'ok' | 'down'

export default function App() {
  const [status, setStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    fetch('/api/v1/health')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((body: { status: string }) => setStatus(body.status === 'ok' ? 'ok' : 'down'))
      .catch(() => setStatus('down'))
  }, [])

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-2xl font-semibold">Movie Money Tracker</h1>
      <p className="mt-2 text-sm text-neutral-400">API: {status}</p>
    </main>
  )
}
