import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useChains } from '../api/chains'
import { errorMessage, fieldErrors } from '../api/errors'
import { useFee, useResetFee, useSaveFee, type Fee } from '../api/fees'
import { primaryButton, quietButton, secondaryButton } from '../components/buttons'
import { Field } from '../components/Field'
import { LoadProblem } from '../components/LoadProblem'
import { Page } from '../components/Page'
import { RadioGroup } from '../components/RadioGroup'
import { monthLabel, shortDate } from '../lib/dates'
import { formatCents, parseDollars } from '../lib/money'

type Source = 'gift_card' | 'bank'

const SOURCES: { value: Source; label: string }[] = [
  { value: 'gift_card', label: 'Gift card' },
  { value: 'bank', label: 'Bank' },
]

const TITLE = 'Edit fee'

export function FeeFormPage() {
  const id = Number(useParams().id)
  const fee = useFee(id)
  const chains = useChains()

  if (fee.isError) return <LoadProblem title={TITLE} what="fee" error={fee.error} />
  if (chains.isError) return <LoadProblem title={TITLE} what="fee" error={chains.error} />
  if (fee.isPending || chains.isPending) return <Page title={TITLE} intro="Loading…" />

  const chain = chains.data.find((c) => c.id === fee.data.chain_id)?.name ?? 'Your'
  const intro = `${chain} subscription for ${monthLabel(fee.data.month)}, billed ${shortDate(fee.data.date).replace(' ', ' ')}.`
  return (
    <Page title={TITLE} intro={intro}>
      <FeeForm fee={fee.data} />
    </Page>
  )
}

type Errors = Partial<Record<'amount' | 'source' | 'form', string>>

function FeeForm({ fee }: { fee: Fee }) {
  const navigate = useNavigate()
  const save = useSaveFee(fee.id)
  const reset = useResetFee(fee.id)
  const [amount, setAmount] = useState(formatCents(fee.amount).replace('$', ''))
  const [source, setSource] = useState<Source>(fee.payment_source === 'bank' ? 'bank' : 'gift_card')
  const [errors, setErrors] = useState<Errors>({})

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    let cents: number | undefined
    try {
      cents = parseDollars(amount)
    } catch {
      cents = undefined
    }
    if (cents === undefined || cents < 0) {
      setErrors({ amount: 'Enter an amount like 12.99, or 0 for a skipped month' })
      return
    }
    setErrors({})
    try {
      await save.mutateAsync({ amount: cents, payment_source: source })
      navigate('/')
    } catch (error) {
      setErrors(fieldErrors(error, { amount: 'amount', payment_source: 'source' }))
    }
  }

  async function handleReset() {
    setErrors({})
    try {
      await reset.mutateAsync()
      navigate('/')
    } catch (error) {
      setErrors({ form: errorMessage(error) })
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-xl flex-col gap-6">
      {fee.is_overridden && (
        <p className="text-sm">
          You've edited this month, so changes to the subscription no longer update it.
        </p>
      )}
      <Field
        label="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={errors.amount}
        inputMode="decimal"
        placeholder="12.99"
        className="w-40"
      />
      <p className="-mt-3 text-sm text-dim">
        Use $0.00 for a month you skipped. It stays in Activity but moves no money.
      </p>
      <RadioGroup
        label="Paid with"
        value={source}
        options={SOURCES}
        onChange={setSource}
        error={errors.source}
      />
      {errors.form && (
        <p role="alert" className="text-sm text-warn">
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryButton} disabled={save.isPending}>
          Save changes
        </button>
        {fee.is_overridden && (
          <button
            type="button"
            className={secondaryButton}
            disabled={reset.isPending}
            onClick={handleReset}
          >
            Reset to plan
          </button>
        )}
        <Link to="/" className={quietButton}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
