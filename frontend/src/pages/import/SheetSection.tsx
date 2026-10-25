import { Link } from 'react-router'
import { useImportStatus } from '../../api/imports'
import { longDate } from '../../lib/dates'

/** Settings' way into the one-time import, and where to find it afterwards. */
export function SheetSection() {
  const status = useImportStatus()
  return (
    <section aria-labelledby="sheet-heading" className="max-w-2xl">
      <h2 id="sheet-heading" className="font-display text-3xl font-bold">
        Your Google Sheet
      </h2>
      {status.data ? (
        <p className="mt-2 text-dim">
          Imported on {longDate(status.data.committed_at.slice(0, 10))}.{' '}
          <Link to="/import" className="text-brass underline underline-offset-4">
            See what came in
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-2 text-dim">
            Bring in the history you kept in your spreadsheet. It runs once, and you review everything first.
          </p>
          <Link to="/import" className="mt-4 inline-block text-brass underline underline-offset-4">
            Import your sheet
          </Link>
        </>
      )}
    </section>
  )
}
