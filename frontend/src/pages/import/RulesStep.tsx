import type { Chain } from '../../api/chains'
import type { ImportChoices } from '../../api/imports'
import { quietButton, secondaryButton } from '../../components/buttons'
import { Field } from '../../components/Field'
import { SelectField } from '../../components/SelectField'
import { longDate } from '../../lib/dates'
import { addBoundary, sortRule } from '../../lib/importChoices'
import { Step } from './Step'

type RulesStepProps = {
  chains: Chain[]
  choices: ImportChoices
  onChange: (choices: ImportChoices) => void
}

export function RulesStep({ chains, choices, onChange }: RulesStepProps) {
  const rule = choices.chain_rule
  const options = [...chains]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: String(c.id), label: c.name }))
  const open = rule[rule.length - 1]

  function setRule(next: ImportChoices['chain_rule']) {
    onChange({ ...choices, chain_rule: sortRule(next) })
  }

  return (
    <Step
      number={2}
      title="Choose what comes in"
      intro="Rows from the cutoff date on are left out, so anything you've already logged in the app isn't added twice."
    >
      <Field
        label="Cutoff date"
        type="date"
        value={choices.cutoff}
        onChange={(e) => e.target.value && onChange({ ...choices, cutoff: e.target.value })}
        className="w-48"
      />

      <h3 className="mt-8 font-semibold">Which chain each row belongs to</h3>
      <p className="mt-1 max-w-prose text-sm text-dim">
        The sheet doesn't say where you watched each film. If you switched chains, add the last day at the old
        one. Gift cards that name their chain keep it.
      </p>
      <ol className="mt-4 flex flex-col gap-4">
        {rule.slice(0, -1).map((span, index) => (
          <li key={index} className="flex flex-wrap items-end gap-3">
            <Field
              label="Up to and including"
              type="date"
              value={span.until ?? ''}
              onChange={(e) =>
                e.target.value && setRule(rule.map((s, i) => (i === index ? { ...s, until: e.target.value } : s)))
              }
            />
            <SelectField
              label="Chain until then"
              value={String(span.chain_id)}
              options={options}
              onChange={(e) =>
                setRule(rule.map((s, i) => (i === index ? { ...s, chain_id: Number(e.target.value) } : s)))
              }
            />
            <button
              type="button"
              className={`${quietButton} pb-2.5`}
              aria-label={`Remove the boundary at ${longDate(span.until!)}`}
              onClick={() => setRule(rule.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </li>
        ))}
        <li>
          <SelectField
            label={rule.length > 1 ? 'Chain after that' : 'Chain for every date'}
            value={String(open.chain_id)}
            options={options}
            onChange={(e) =>
              setRule(rule.map((s, i) => (i === rule.length - 1 ? { ...s, chain_id: Number(e.target.value) } : s)))
            }
            className="w-fit min-w-48"
          />
        </li>
      </ol>
      {chains.length > 1 && (
        <button
          type="button"
          className={`${secondaryButton} mt-4`}
          onClick={() => setRule(addBoundary(rule, choices.cutoff, open.chain_id))}
        >
          Add a date boundary
        </button>
      )}
    </Step>
  )
}
