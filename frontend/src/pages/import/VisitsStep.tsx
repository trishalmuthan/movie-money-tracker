import type { Chain } from '../../api/chains'
import type { ImportChoices, ImportProposal } from '../../api/imports'
import { RadioGroup } from '../../components/RadioGroup'
import { shortDate } from '../../lib/dates'
import { withRowChoice } from '../../lib/importChoices'
import { formatCents } from '../../lib/money'
import { MoneyField } from './MoneyField'
import { Step } from './Step'
import { blockerFor, chainName } from './review'

type Visit = ImportProposal['visits'][number]
type Credit = ImportProposal['credits'][number]
type Paid = 'gift_card' | 'bank'

const PAID: { value: Paid; label: string }[] = [
  { value: 'gift_card', label: 'Gift card' },
  { value: 'bank', label: 'Bank' },
]

type VisitsStepProps = {
  chains: Chain[]
  proposal: ImportProposal
  choices: ImportChoices
  onChange: (choices: ImportChoices) => void
}

export function VisitsStep({ chains, proposal, choices, onChange }: VisitsStepProps) {
  const paid = proposal.visits.filter((v) => v.my_cost + v.guest_cost > 0)
  const free = proposal.visits.length - paid.length
  const choose = (key: Visit['key'], patch: Parameters<typeof withRowChoice>[2]) =>
    onChange(withRowChoice(choices, key, patch))

  return (
    <Step
      number={5}
      title="Check visits you paid for"
      intro={`Paid visits default to a gift card when you had one for that chain by then, otherwise the bank. Guests' share is an even split. ${free} free visit${free === 1 ? '' : 's'} need nothing from you.`}
    >
      {paid.length === 0 && proposal.credits.length === 0 ? (
        <p>Every visit was free.</p>
      ) : (
        <ul className="divide-y divide-velvet/60 border-y border-velvet/60">
          {paid.map((visit) => (
            <VisitRow
              key={`v${visit.key.file}:${visit.key.line}`}
              visit={visit}
              chain={chainName(chains, visit.chain_id)}
              blocker={blockerFor(proposal, visit.key)}
              onChoose={(patch) => choose(visit.key, patch)}
            />
          ))}
          {proposal.credits.map((credit) => (
            <RefundRow
              key={`c${credit.key.file}:${credit.key.line}`}
              credit={credit}
              title={proposal.visits.find((v) => v.key.file === credit.key.file && v.key.line === credit.key.line)?.title ?? ''}
              onChoose={(destination) => choose(credit.key, { refund_destination: destination })}
            />
          ))}
        </ul>
      )}
    </Step>
  )
}

type VisitRowProps = {
  visit: Visit
  chain: string | undefined
  blocker: string | undefined
  onChoose: (patch: Parameters<typeof withRowChoice>[2]) => void
}

function VisitRow({ visit, chain, blocker, onChoose }: VisitRowProps) {
  const total = visit.my_cost + visit.guest_cost
  return (
    <li aria-label={visit.title} className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="mr-3 text-sm text-dim">{shortDate(visit.date)}</span>
          {visit.title}
          {chain && <span className="text-dim">, {chain}</span>}
        </p>
        <p className="money text-xl">{formatCents(total)}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        {visit.guest_count > 0 && (
          <>
            {/* Changing one side moves the other, so the split keeps adding up to what was paid. */}
            <MoneyField
              key={`mine-${visit.my_cost}`}
              label="Yours"
              cents={visit.my_cost}
              onCommit={(cents) => onChoose({ my_cost: cents, guest_cost: Math.max(total - cents, 0) })}
            />
            <MoneyField
              key={`guests-${visit.guest_cost}`}
              label={`Guests (${visit.guest_count})`}
              cents={visit.guest_cost}
              onCommit={(cents) => onChoose({ guest_cost: cents, my_cost: Math.max(total - cents, 0) })}
            />
          </>
        )}
        <RadioGroup
          label="Paid with"
          value={visit.payment_source === 'bank' ? 'bank' : 'gift_card'}
          options={PAID}
          onChange={(source) => onChoose({ payment_source: source })}
        />
      </div>
      {blocker && (
        <p role="alert" className="mt-2 text-sm text-warn">
          {blocker}
        </p>
      )}
    </li>
  )
}

function RefundRow({ credit, title, onChoose }: { credit: Credit; title: string; onChoose: (destination: Paid) => void }) {
  return (
    <li aria-label={`Refund for ${title}`} className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="mr-3 text-sm text-dim">{shortDate(credit.date)}</span>
          Refund for {title}
        </p>
        <p className="money text-xl">-{formatCents(credit.amount)}</p>
      </div>
      <div className="mt-3">
        <RadioGroup label="Refunded to" value={credit.destination} options={PAID} onChange={onChoose} />
      </div>
    </li>
  )
}
