import { Link } from 'react-router'
import type { ImportResult } from '../../api/imports'
import { longDate } from '../../lib/dates'
import { formatCents } from '../../lib/money'

/** What a committed import brought in, beside what the sheet itself adds up to. */
export function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <div className="max-w-2xl">
      <p>Your sheet was imported on {longDate(result.committed_at.slice(0, 10))}.</p>
      <p className="mt-1 text-sm text-dim">
        Rows dated {longDate(result.cutoff)} or later were left to the app.
      </p>
      <ul className="mt-6 divide-y divide-velvet/60 border-y border-velvet/60">
        {result.files.map((file) => (
          <li key={file.name} aria-label={file.name} className="py-3">
            <p>{file.name}</p>
            <p className="text-sm text-dim">
              Sheet total {formatCents(file.legacy_total)}, {file.tickets} tickets
            </p>
            <p className="text-sm">
              Imported {formatCents(file.imported_total)}, {file.imported_tickets} tickets
            </p>
          </li>
        ))}
      </ul>
      <Link to="/" className="mt-6 inline-block text-brass underline underline-offset-4">
        Go to Activity
      </Link>
    </div>
  )
}
