import type { Chain } from '../../api/chains'
import type { ImportChoices, ImportProposal } from '../../api/imports'
import { secondaryButton } from '../../components/buttons'
import { Field } from '../../components/Field'
import { RadioGroup } from '../../components/RadioGroup'
import { SelectField } from '../../components/SelectField'
import { longDate } from '../../lib/dates'
import { MoneyField } from './MoneyField'
import { Step } from './Step'
import { chainName } from './review'

type Period = ImportProposal['periods'][number]
type Paid = 'gift_card' | 'bank'

const PAID: { value: Paid; label: string }[] = [
  { value: 'gift_card', label: 'Gift card' },
  { value: 'bank', label: 'Bank' },
]

type PeriodsStepProps = {
  chains: Chain[]
  proposal: ImportProposal
  choices: ImportChoices
  onChange: (choices: ImportChoices) => void
}

export function PeriodsStep({ chains, proposal, choices, onChange }: PeriodsStepProps) {
  const periods = proposal.periods
  const edited = choices.periods !== null && choices.periods !== undefined

  // The first edit freezes the proposal into your own list; "Use the proposed periods" undoes that.
  function edit(index: number, patch: Partial<Period>) {
    onChange({ ...choices, periods: periods.map((p, i) => (i === index ? { ...p, ...patch } : p)) })
  }

  return (
    <Step
      number={6}
      title="Check your subscription periods"
      intro="Your sheet's monthly fees become subscription periods: a new one starts whenever the price or chain changed. Each fee keeps its real amount and date, and the app fills any month the sheet missed."
    >
      {periods.length === 0 ? (
        <p>No subscription fees in these files.</p>
      ) : (
        <ol className="flex flex-col gap-6">
          {periods.map((period, index) => (
            <PeriodRow
              key={JSON.stringify(period)}
              period={period}
              chains={chains}
              fees={proposal.fees.filter((f) => f.period_index === index).length}
              onEdit={(patch) => edit(index, patch)}
            />
          ))}
        </ol>
      )}
      {edited && (
        <button type="button" className={`${secondaryButton} mt-6`} onClick={() => onChange({ ...choices, periods: null })}>
          Use the proposed periods
        </button>
      )}
    </Step>
  )
}

type PeriodRowProps = {
  period: Period
  chains: Chain[]
  fees: number
  onEdit: (patch: Partial<Period>) => void
}

function PeriodRow({ period, chains, fees, onEdit }: PeriodRowProps) {
  const name = chainName(chains, period.chain_id) ?? 'Unknown chain'
  const label = `${name}, from ${longDate(period.start_date)}`
  return (
    <li aria-label={label} className="rounded-lg border border-velvet px-4 py-4">
      <p className="font-semibold">{label}</p>
      <p className="text-sm text-dim">
        {fees} fee{fees === 1 ? '' : 's'} from your sheet
        {period.end_date === null && '. Ongoing: the app adds each month from here on'}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <SelectField
          label="Chain"
          value={String(period.chain_id)}
          options={chains.map((c) => ({ value: String(c.id), label: c.name }))}
          onChange={(e) => onEdit({ chain_id: Number(e.target.value) })}
        />
        <MoneyField label="Monthly price" cents={period.amount} onCommit={(amount) => onEdit({ amount })} className="" />
        <Field
          label="Billing day"
          defaultValue={String(period.billing_day)}
          inputMode="numeric"
          onBlur={(e) => {
            const day = Number(e.target.value)
            if (Number.isInteger(day) && day !== period.billing_day) onEdit({ billing_day: day })
          }}
        />
        <Field
          label="Starts"
          type="date"
          value={period.start_date}
          onChange={(e) => e.target.value && onEdit({ start_date: e.target.value })}
        />
        <Field
          label="Ends (blank if ongoing)"
          type="date"
          value={period.end_date ?? ''}
          onChange={(e) => onEdit({ end_date: e.target.value || null })}
        />
      </div>
      <div className="mt-4">
        <RadioGroup
          label="Paid with"
          value={period.payment_source === 'bank' ? 'bank' : 'gift_card'}
          options={PAID}
          onChange={(payment_source) => onEdit({ payment_source })}
        />
      </div>
    </li>
  )
}
