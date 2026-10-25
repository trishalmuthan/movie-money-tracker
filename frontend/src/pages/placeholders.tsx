import { Link } from 'react-router'
import { Page } from '../components/Page'

// Activity is replaced by its real screen in #35.

export function ActivityPage() {
  return (
    <Page
      title="Activity"
      intro="Every visit, gift card and refund you log will be listed here, newest first, with what each one really cost."
    />
  )
}

export function NotFoundPage() {
  return (
    <Page title="Page not found" intro="There's no page at this address.">
      <Link to="/" className="text-brass underline underline-offset-4">
        Go to Activity
      </Link>
    </Page>
  )
}
