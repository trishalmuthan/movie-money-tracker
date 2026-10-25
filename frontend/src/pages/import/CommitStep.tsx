import { errorMessage } from '../../api/errors'
import { useCommitImport, type ImportChoices, type ImportFile, type ImportProposal } from '../../api/imports'
import { primaryButton } from '../../components/buttons'
import { formatCents } from '../../lib/money'
import { Step } from './Step'

type CommitStepProps = {
  files: ImportFile[]
  choices: ImportChoices
  proposal: ImportProposal
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function CommitStep({ files, choices, proposal }: CommitStepProps) {
  const commit = useCommitImport()
  const errors = new Set(proposal.errors.map((e) => `${e.file}:${e.line}`)).size
  const problems = [
    ...(errors ? [`${plural(errors, 'unreadable row')} to fix or skip (step 3)`] : []),
    ...proposal.blockers.map((b) => b.message),
  ]
  const what = [
    plural(proposal.visits.length, 'visit'),
    plural(proposal.cards.length, 'gift card'),
    plural(proposal.credits.length, 'refund'),
    `${plural(proposal.fees.length, 'fee')} in ${plural(proposal.periods.length, 'subscription period')}`,
  ]

  return (
    <Step number={7} title="Import">
      <p>This brings in {what.join(', ')}.</p>
      <ul className="mt-4 flex flex-col gap-1 text-sm">
        {proposal.totals.map((t) => (
          <li key={t.name}>
            {t.name}: {formatCents(t.imported_total)} of the sheet's {formatCents(t.legacy_total)}
            {t.imported_total !== t.legacy_total && ' (the rest is after the cutoff or skipped)'}
          </li>
        ))}
      </ul>

      {problems.length > 0 && (
        <div className="mt-6 rounded-lg border border-warn/60 px-4 py-3">
          <p className="font-semibold text-warn">Before you can import</p>
          <ul aria-label="Before you can import" className="mt-2 list-disc pl-5 text-sm">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {commit.isError && (
        <p role="alert" className="mt-4 text-warn">
          {errorMessage(commit.error)}
        </p>
      )}
      <button
        type="button"
        className={`${primaryButton} mt-6`}
        disabled={!proposal.ready || commit.isPending}
        onClick={() => commit.mutate({ files, choices })}
      >
        {commit.isPending ? 'Importing…' : 'Import your sheet'}
      </button>
    </Step>
  )
}
