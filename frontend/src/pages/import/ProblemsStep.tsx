import { useState } from 'react'
import type { ImportChoices, ImportFile, ImportProposal } from '../../api/imports'
import { quietButton, secondaryButton } from '../../components/buttons'
import { Field } from '../../components/Field'
import { shortDate } from '../../lib/dates'
import { withFix, withRowChoice } from '../../lib/importChoices'
import { Step } from './Step'

type RowError = ImportProposal['errors'][number]
type Column = ImportChoices['fixes'][number]['column']

type ProblemsStepProps = {
  files: ImportFile[]
  proposal: ImportProposal
  choices: ImportChoices
  onChange: (choices: ImportChoices) => void
}

export function ProblemsStep({ files, proposal, choices, onChange }: ProblemsStepProps) {
  // One group per row: a row can have a bad amount and a bad date.
  const rows = new Map<string, RowError[]>()
  for (const error of proposal.errors) {
    const key = `${error.file}:${error.line}`
    rows.set(key, [...(rows.get(key) ?? []), error])
  }

  return (
    <Step
      number={3}
      title="Fix unreadable rows"
      intro="Correct a value here (your sheet isn't changed), or skip the row. Nothing is left out without you knowing."
    >
      {rows.size === 0 ? (
        <p>Every row could be read.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {[...rows.values()].map((errors) => (
            <ProblemRow key={`${errors[0].file}:${errors[0].line}`} errors={errors} fileName={files[errors[0].file]?.name ?? ''} choices={choices} onChange={onChange} />
          ))}
        </div>
      )}
      <LeftOut proposal={proposal} choices={choices} onChange={onChange} />
    </Step>
  )
}

type ProblemRowProps = {
  errors: RowError[]
  fileName: string
  choices: ImportChoices
  onChange: (choices: ImportChoices) => void
}

function ProblemRow({ errors, fileName, choices, onChange }: ProblemRowProps) {
  const { file, line, item } = errors[0]
  const where = `Line ${line} of ${fileName}`
  return (
    <fieldset className="rounded-lg border border-velvet px-4 pt-2 pb-4">
      <legend className="px-1">
        {where}: {item || 'no item'}
      </legend>
      <div className="flex flex-wrap items-start gap-4">
        {errors.map((error) => (
          <FixField
            key={error.column}
            error={error}
            onFix={(value) => onChange(withFix(choices, file, line, error.column as Column, value))}
          />
        ))}
        <button
          type="button"
          className={`${secondaryButton} mt-7`}
          aria-label={`Skip line ${line} of ${fileName}`}
          onClick={() => onChange(withRowChoice(choices, { file, line }, { skip: true }))}
        >
          Skip this row
        </button>
      </div>
    </fieldset>
  )
}

/** A cell's corrected value, sent when you leave the field (not on every keystroke). */
function FixField({ error, onFix }: { error: RowError; onFix: (value: string) => void }) {
  const [value, setValue] = useState(error.value)
  return (
    <Field
      label={error.column}
      value={value}
      error={error.message}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== error.value && onFix(value)}
      className="w-44"
    />
  )
}

function LeftOut({ proposal, choices, onChange }: Omit<ProblemsStepProps, 'files'>) {
  const count = proposal.left_out.length
  if (count === 0) return null
  const label = `${count} row${count === 1 ? '' : 's'} left out`
  return (
    <section role="group" aria-label={label} className="mt-8">
      <details>
        <summary className="cursor-pointer font-semibold">{label}</summary>
        <ul className="mt-3 divide-y divide-velvet/60 border-y border-velvet/60">
          {proposal.left_out.map((row) => (
            <li key={`${row.key.file}:${row.key.line}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="w-14 text-sm text-dim">{row.date ? shortDate(row.date) : ''}</span>
              <span className="min-w-0 flex-1 break-words">{row.item}</span>
              <span className="text-sm text-dim">{row.reason === 'skipped' ? 'Skipped' : 'On or after the cutoff'}</span>
              {row.reason === 'skipped' && (
                <button
                  type="button"
                  className={quietButton}
                  aria-label={`Undo skip of ${row.item}`}
                  onClick={() => onChange(withRowChoice(choices, row.key, { skip: false }))}
                >
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
