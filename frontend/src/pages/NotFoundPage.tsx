import { Link } from 'react-router'
import { Page } from '../components/Page'

export function NotFoundPage() {
  return (
    <Page title="Page not found" intro="There's no page at this address.">
      <Link to="/" className="text-brass underline underline-offset-4">
        Go to Activity
      </Link>
    </Page>
  )
}
