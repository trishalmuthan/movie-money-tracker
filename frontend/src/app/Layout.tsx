import { Link, NavLink, Outlet } from 'react-router'
import { useApiStatus } from './useApiStatus'

const NAV = [
  { to: '/', label: 'Activity' },
  { to: '/visits/new', label: 'Log visit', primary: true },
  { to: '/gift-cards/new', label: 'Gift card' },
  { to: '/credits/new', label: 'Refund' },
  { to: '/settings', label: 'Settings' },
] as const

function navLinkClass(isActive: boolean, primary: boolean): string {
  const base =
    'flex items-center justify-center px-1 py-3 text-sm md:rounded-full md:px-4 md:py-1.5'
  if (primary) {
    // The one brass action: a filled button on wide screens, brass text in the tab bar.
    return `${base} font-semibold text-brass md:bg-brass md:text-house md:order-last ${
      isActive ? 'bg-velvet md:bg-brass md:ring-2 md:ring-screen/70' : ''
    }`
  }
  return `${base} ${isActive ? 'bg-velvet text-screen' : 'text-dim hover:text-screen'}`
}

export function Layout() {
  const status = useApiStatus()

  return (
    <div className="min-h-dvh">
      <header className="border-b border-velvet/70">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-6 px-4">
          <Link to="/" className="font-display text-3xl leading-none font-bold tracking-wide">
            Movie Money
          </Link>
          <nav
            aria-label="Main"
            className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-velvet bg-house-raised pb-[env(safe-area-inset-bottom)] md:pb-0 md:static md:flex md:items-center md:gap-1 md:border-0 md:bg-transparent"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => navLinkClass(isActive, 'primary' in item)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {status === 'down' && (
        <div role="alert" className="border-b border-warn/40 bg-warn/10 text-warn">
          <p className="mx-auto max-w-5xl px-4 py-3 text-sm">
            Can't reach the app's server. Make sure the backend is running, then reload this
            page.
          </p>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 pt-10 pb-28 md:pb-16">
        <Outlet />
      </main>
    </div>
  )
}
