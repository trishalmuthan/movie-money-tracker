import { Link } from 'react-router'
import { Page } from '../components/Page'

// Each of these is replaced by its real screen later in M2 (issues #33–#35).

export function ActivityPage() {
  return (
    <Page
      title="Activity"
      intro="Every visit, gift card and refund you log will be listed here, newest first, with what each one really cost."
    />
  )
}

export function VisitFormPage({ mode }: { mode: 'new' | 'edit' }) {
  return (
    <Page
      title={mode === 'new' ? 'Log a visit' : 'Edit visit'}
      intro="Record the film, the date, what you paid and anyone you brought."
    />
  )
}

export function GiftCardFormPage({ mode }: { mode: 'new' | 'edit' }) {
  return (
    <Page
      title={mode === 'new' ? 'Add a gift card' : 'Edit gift card'}
      intro="Record what you paid and the balance you got, and see the discount."
    />
  )
}

export function CreditFormPage({ mode }: { mode: 'new' | 'edit' }) {
  return (
    <Page
      title={mode === 'new' ? 'Add a refund' : 'Edit refund'}
      intro="Record money that came back to your bank or onto a gift card."
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
