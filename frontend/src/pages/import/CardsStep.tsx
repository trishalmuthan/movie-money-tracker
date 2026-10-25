import { useState } from 'react'
import type { Chain } from '../../api/chains'
import type { ImportChoices, ImportProposal, RowKey } from '../../api/imports'
import { secondaryButton } from '../../components/buttons'
import { SelectField } from '../../components/SelectField'
import { longDate } from '../../lib/dates'
import { withRowChoice } from '../../lib/importChoices'
import { formatCents } from '../../lib/money'
import { MoneyField } from './MoneyField'
import { Step } from './Step'
import { blockerFor, chainName } from './review'

type Card = ImportProposal['cards'][number]

type CardsStepProps = {
  chains: Chain[]
  proposal: ImportProposal
  choices: ImportChoices
  onChange: (choices: ImportChoices) => void
}

export function CardsStep({ chains, proposal, choices, onChange }: CardsStepProps) {
  return (
    <Step
      number={4}
      title="Confirm your gift card values"
      intro="The sheet only has what you paid. Enter what each card was worth, so the app knows your discount."
    >
      {proposal.cards.length === 0 ? (
        <p>No gift cards in these files.</p>
      ) : (
        <ul className="divide-y divide-velvet/60 border-y border-velvet/60">
          {proposal.cards.map((card) => (
            <CardRow
              key={`${card.key.file}:${card.key.line}`}
              card={card}
              chains={chains}
              blocker={blockerFor(proposal, card.key)}
              onChoose={(key, patch) => onChange(withRowChoice(choices, key, patch))}
            />
          ))}
        </ul>
      )}
    </Step>
  )
}

type CardRowProps = {
  card: Card
  chains: Chain[]
  blocker: string | undefined
  onChoose: (key: RowKey, patch: { face_value?: number; chain_id?: number }) => void
}

function CardRow({ card, chains, blocker, onChoose }: CardRowProps) {
  const [value, setValue] = useState(card.face_value)
  const name = chainName(chains, card.chain_id)
  const label = `${formatCents(card.price_paid)} ${name ? `${name} ` : ''}card, ${longDate(card.date)}`

  return (
    <li aria-label={label} className="flex flex-wrap items-end gap-4 py-4">
      <div className="min-w-48 flex-1">
        <p>{label}</p>
        <p className={`text-sm ${card.confirmed ? 'text-dim' : 'text-warn'}`}>
          {card.confirmed ? `Confirmed: worth ${formatCents(card.face_value)}` : (blocker ?? 'Not confirmed yet')}
        </p>
      </div>
      {card.chain_id === null && (
        <SelectField
          label="Chain"
          value=""
          options={[{ value: '', label: 'Choose a chain' }, ...chains.map((c) => ({ value: String(c.id), label: c.name }))]}
          onChange={(e) => e.target.value && onChoose(card.key, { chain_id: Number(e.target.value) })}
        />
      )}
      <MoneyField
        label="Card value"
        cents={card.face_value}
        onCommit={(cents) => {
          setValue(cents)
          if (card.confirmed) onChoose(card.key, { face_value: cents })
        }}
      />
      {!card.confirmed && (
        <button
          type="button"
          className={`${secondaryButton} mb-0.5`}
          aria-label={`Confirm the value of the ${label}`}
          onClick={() => onChoose(card.key, { face_value: value })}
        >
          Confirm
        </button>
      )}
    </li>
  )
}
