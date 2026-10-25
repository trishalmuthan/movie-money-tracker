import { useState, type FormEvent, type ReactNode } from 'react'
import { useChains, type Chain } from '../api/chains'
import { errorMessage, fieldErrors } from '../api/errors'
import {
  useChangePrice,
  useCreatePlan,
  useDeletePlan,
  usePlans,
  useUpdatePlan,
  type Plan,
  type PlanInput,
} from '../api/plans'
import { dangerButton, quietButton, secondaryButton } from '../components/buttons'
import { Field } from '../components/Field'
import { RadioGroup } from '../components/RadioGroup'
import { SelectField } from '../components/SelectField'
import { longDate, ordinal, todayIso } from '../lib/dates'
import { formatCents, parseDollars } from '../lib/money'

type Source = 'gift_card' | 'bank'

const SOURCES: { value: Source; label: string }[] = [
  { value: 'gift_card', label: 'Gift card' },
  { value: 'bank', label: 'Bank' },
]

function tryPositiveCents(text: string): number | undefined {
  try {
    const cents = parseDollars(text)
    return cents > 0 ? cents : undefined
  } catch {
    return undefined
  }
}

export function SubscriptionsSection() {
  const chains = useChains()
  const plans = usePlans()
  const create = useCreatePlan()

  let body: ReactNode
  if (chains.isPending || plans.isPending) {
    body = <p className="mt-6 text-dim">Loading subscriptions…</p>
  } else if (chains.isError || plans.isError) {
    body = (
      <p role="alert" className="mt-6 text-warn">
        {errorMessage(chains.error ?? plans.error)}
      </p>
    )
  } else if (chains.data.length === 0) {
    body = (
      <p className="mt-6">
        A subscription belongs to a theatre chain.{' '}
        <a href="#chains-heading" className="text-brass underline underline-offset-4">
          Add a theatre chain
        </a>{' '}
        first.
      </p>
    )
  } else {
    const chainNames = new Map(chains.data.map((c) => [c.id, c.name]))
    // Same order as the chains above; a chain's periods oldest first.
    const sorted = [...plans.data].sort(
      (a, b) =>
        (chainNames.get(a.chain_id) ?? '').localeCompare(chainNames.get(b.chain_id) ?? '') ||
        a.start_date.localeCompare(b.start_date),
    )
    body = (
      <>
        {plans.data.length === 0 ? (
          <p className="mt-6">No subscriptions yet.</p>
        ) : (
          <ul className="mt-6 divide-y divide-velvet/60 border-y border-velvet/60">
            {sorted.map((plan) => (
              <PlanRow key={plan.id} plan={plan} chainName={chainNames.get(plan.chain_id) ?? ''} />
            ))}
          </ul>
        )}
        <div className="mt-8">
          <h3 className="mb-3 font-semibold">Add a subscription</h3>
          <PlanForm chains={chains.data} onSubmit={(input) => create.mutateAsync(input)} />
        </div>
      </>
    )
  }

  return (
    <section aria-labelledby="subscriptions-heading" className="max-w-2xl">
      <h2 id="subscriptions-heading" className="font-display text-3xl font-bold">
        Subscriptions
      </h2>
      <p className="mt-2 text-dim">
        Describe your subscription once and each month's fee is added to Activity on its billing
        day. A price change starts a new period, so earlier months keep the price you paid.
      </p>
      {body}
    </section>
  )
}

type RowMode = 'view' | 'change-price' | 'end' | 'confirm-delete'

function PlanRow({ plan, chainName }: { plan: Plan; chainName: string }) {
  const [mode, setMode] = useState<RowMode>('view')
  const remove = useDeletePlan()
  const source = plan.payment_source === 'bank' ? 'paid by bank' : 'paid with gift card'
  const period = plan.end_date
    ? `${longDate(plan.start_date)} to ${longDate(plan.end_date)}`
    : `From ${longDate(plan.start_date)}`

  function open(next: RowMode) {
    remove.reset()
    setMode(next)
  }

  return (
    <li className="py-4">
      <p className="money text-2xl leading-none">{formatCents(plan.amount)}</p>
      <p className="mt-2">
        {chainName}, billed on the {ordinal(plan.billing_day)}, {source}
      </p>
      <p className="text-sm text-dim">{period}</p>
      {mode === 'view' && (
        <div className="-ml-2 mt-1 flex flex-wrap gap-1">
          {plan.end_date === null && (
            <>
              <button type="button" className={quietButton} onClick={() => open('change-price')}>
                Change price
              </button>
              <button type="button" className={quietButton} onClick={() => open('end')}>
                End
              </button>
            </>
          )}
          <button type="button" className={quietButton} onClick={() => open('confirm-delete')}>
            Delete
          </button>
        </div>
      )}

      {mode === 'change-price' && <ChangePriceForm plan={plan} onDone={() => setMode('view')} />}
      {mode === 'end' && <EndForm plan={plan} onDone={() => setMode('view')} />}
      {mode === 'confirm-delete' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm">Delete this subscription and its fees?</span>
          <button
            type="button"
            className={dangerButton}
            disabled={remove.isPending}
            onClick={() => remove.mutate(plan.id)}
          >
            Yes, delete
          </button>
          <button type="button" className={quietButton} onClick={() => setMode('view')}>
            Keep it
          </button>
        </div>
      )}
      {remove.isError && (
        <p role="alert" className="mt-2 text-sm text-warn">
          {errorMessage(remove.error)}
        </p>
      )}
    </li>
  )
}

/** The fields of a plan the API takes back on PUT. */
function planInput(plan: Plan): PlanInput {
  return {
    chain_id: plan.chain_id,
    amount: plan.amount,
    billing_day: plan.billing_day,
    start_date: plan.start_date,
    end_date: plan.end_date,
    payment_source: plan.payment_source,
  }
}

function ChangePriceForm({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const change = useChangePrice()
  const [price, setPrice] = useState('')
  const [month, setMonth] = useState('')
  const [errors, setErrors] = useState<{ price?: string; month?: string; form?: string }>({})

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const cents = tryPositiveCents(price)
    const next: typeof errors = {}
    if (cents === undefined) next.price = 'Enter the new price, like 12.99'
    if (!month) next.month = 'Pick the first month at the new price'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    try {
      await change.mutateAsync({ id: plan.id, amount: cents!, fromMonth: month })
      onDone()
    } catch (error) {
      setErrors(fieldErrors(error, { amount: 'price', from_month: 'month' }))
    }
  }

  return (
    <InlineForm
      onSubmit={handleSubmit}
      submitLabel="Save new price"
      busy={change.isPending}
      error={errors.form}
      onCancel={onDone}
    >
      <Field
        label="New price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        error={errors.price}
        inputMode="decimal"
        placeholder="12.99"
        className="w-32"
      />
      <Field
        label="From"
        type="month"
        value={month}
        min={plan.start_date.slice(0, 7)}
        onChange={(e) => setMonth(e.target.value)}
        error={errors.month}
      />
    </InlineForm>
  )
}

function EndForm({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const update = useUpdatePlan()
  const [lastDay, setLastDay] = useState('')
  const [errors, setErrors] = useState<{ lastDay?: string; form?: string }>({})

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!lastDay) {
      setErrors({ lastDay: 'Enter the last day of the subscription' })
      return
    }
    setErrors({})
    try {
      await update.mutateAsync({ id: plan.id, body: { ...planInput(plan), end_date: lastDay } })
      onDone()
    } catch (error) {
      setErrors(fieldErrors(error, { end_date: 'lastDay' }))
    }
  }

  return (
    <InlineForm
      onSubmit={handleSubmit}
      submitLabel="End subscription"
      busy={update.isPending}
      error={errors.form}
      onCancel={onDone}
    >
      <Field
        label="Last day"
        type="date"
        value={lastDay}
        min={plan.start_date}
        onChange={(e) => setLastDay(e.target.value)}
        error={errors.lastDay}
      />
    </InlineForm>
  )
}

type InlineFormProps = {
  onSubmit: (event: FormEvent) => void
  submitLabel: string
  busy: boolean
  error?: string
  onCancel: () => void
  children: ReactNode
}

/** A row action's small form; a refusal from the API shows right under it. */
function InlineForm({ onSubmit, submitLabel, busy, error, onCancel, children }: InlineFormProps) {
  return (
    <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-wrap items-start gap-3">
      {children}
      <div className="flex gap-2 self-end pb-0.5">
        <button type="submit" className={secondaryButton} disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className={quietButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="w-full text-sm text-warn">
          {error}
        </p>
      )}
    </form>
  )
}

type PlanField = 'chain' | 'price' | 'day' | 'start' | 'source'

const API_FIELDS: Record<string, PlanField> = {
  chain_id: 'chain',
  amount: 'price',
  billing_day: 'day',
  start_date: 'start',
  payment_source: 'source',
}

function PlanForm({ chains, onSubmit }: { chains: Chain[]; onSubmit: (input: PlanInput) => Promise<unknown> }) {
  const [chainId, setChainId] = useState(String(chains[0].id))
  const [price, setPrice] = useState('')
  const [day, setDay] = useState('')
  const [start, setStart] = useState(todayIso())
  const [source, setSource] = useState<Source>('gift_card')
  const [errors, setErrors] = useState<Partial<Record<PlanField | 'form', string>>>({})
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const cents = tryPositiveCents(price)
    const dayNumber = Number(day)
    const next: typeof errors = {}
    if (cents === undefined) next.price = 'Enter the monthly price, like 12.99'
    if (!/^\d+$/.test(day.trim()) || dayNumber < 1 || dayNumber > 28) {
      next.day = 'Pick a day from 1 to 28'
    }
    if (!start) next.start = 'Enter the first day of the subscription'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    try {
      await onSubmit({
        chain_id: Number(chainId),
        amount: cents!,
        billing_day: dayNumber,
        start_date: start,
        end_date: null,
        payment_source: source,
      })
      setPrice('')
      setDay('')
    } catch (error) {
      setErrors(fieldErrors(error, API_FIELDS))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[1fr_8rem_7rem]">
        <SelectField
          label="Chain"
          value={chainId}
          onChange={(e) => setChainId(e.target.value)}
          options={chains.map((c) => ({ value: String(c.id), label: c.name }))}
          error={errors.chain}
          className="col-span-2 sm:col-span-1"
        />
        <Field
          label="Monthly price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={errors.price}
          inputMode="decimal"
          placeholder="12.99"
        />
        <Field
          label="Billing day"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          error={errors.day}
          inputMode="numeric"
          placeholder="1–28"
        />
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <Field
          label="Starts"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          error={errors.start}
        />
        <RadioGroup
          label="Paid with"
          value={source}
          options={SOURCES}
          onChange={setSource}
          error={errors.source}
        />
      </div>
      <div>
        <button type="submit" className={secondaryButton} disabled={saving}>
          Add subscription
        </button>
      </div>
      {errors.form && (
        <p role="alert" className="text-sm text-warn">
          {errors.form}
        </p>
      )}
    </form>
  )
}
