import { Link } from 'react-router'
import { ApiError, errorMessage } from '../api/errors'
import { Page } from './Page'

/** What an edit page shows when its entry can't be loaded: missing (404) or unreachable. */
export function LoadProblem({ title, what, error }: { title: string; what: string; error: unknown }) {
  const missing = error instanceof ApiError && error.status === 404
  return (
    <Page title={title}>
      <p role="alert" className="text-warn">
        {missing ? `This ${what} doesn't exist. It may have been deleted.` : errorMessage(error)}
      </p>
      <Link to="/" className="mt-4 inline-block text-brass underline underline-offset-4">
        Go to Activity
      </Link>
    </Page>
  )
}

/** What a form page shows when there are no chains to pick from yet. */
export function NeedsChain({ title, what }: { title: string; what: string }) {
  return (
    <Page title={title} intro={`${what} belong to a theatre chain, and there aren't any yet.`}>
      <Link to="/settings" className="text-brass underline underline-offset-4">
        Add a chain in Settings
      </Link>
    </Page>
  )
}
