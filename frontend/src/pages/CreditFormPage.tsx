import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useChains, type Chain } from '../api/chains'
import {
  useCredit,
  useSaveCredit,
  type Credit,
  type CreditDestination,
  type CreditInput,
} from '../api/credits'
import { fieldErrors } from '../api/errors'
import { primaryButton, quietButton } from '../components/buttons'
import { Field } from '../components/Field'
import { LoadProblem } from '../components/LoadProblem'
import { Page } from '../components/Page'
import { RadioGroup } from '../components/RadioGroup'
import { SelectField } from '../components/SelectField'
import { todayIso } from '../lib/dates'
import { formatCents, parseDollars } from '../lib/money'

const DESTINATIONS: { value: CreditDestination; label: string }[] = [
  { value: 'bank', label: 'Bank' },
  { value: 'gift_card', label: 'Gift card' },
]

const INTRO =
  "Money that came back to you, like a refunded ticket. A refund lowers what you've spent."

export function CreditFormPage({ mode }: { mode: 'new' | 'edit' }) {
  const params = useParams()
  const id = mode === 'edit' ? Number(params.id) : undefined
  const chains = useChains()
  const credit = useCredit(id)
  const title = mode === 'new' ? 'Add a refund' : 'Edit refund'

  if (credit.isError) return <LoadProblem title={title} what="refund" error={credit.error} />
  if (chains.isError) return <LoadProblem title={title} what="refund" error={chains.error} />
  if (chains.isPending || (id !== undefined && credit.isPending)) {
    return <Page title={title} intro="Loading…" />
  }
  return (
    <Page title={title} intro={INTRO}>
      <CreditForm id={id} chains={chains.data} credit={credit.data} />
    </Page>
  )
}

type FieldName = 'date' | 'amount' | 'destination' | 'chain' | 'note'
type Errors = Partial<Record<FieldName | 'form', string>>

const API_FIELDS: Record<string, FieldName> = {
  date: 'date',
  amount: 'amount',
  destination: 'destination',
  chain_id: 'chain',
  note: 'note',
}

type CreditFormProps = { id: number | undefined; chains: Chain[]; credit: Credit | undefined }

function CreditForm({ id, chains, credit }: CreditFormProps) {
  const navigate = useNavigate()
  const save = useSaveCredit(id)
  const [date, setDate] = useState(credit?.date ?? todayIso())
  const [amount, setAmount] = useState(credit ? formatCents(credit.amount).replace('$', '') : '')
  const [destination, setDestination] = useState<CreditDestination>(
    credit?.destination ?? 'bank',
  )
  const [chainId, setChainId] = useState(credit?.chain_id ? String(credit.chain_id) : '')
  const [note, setNote] = useState(credit?.note ?? '')
  const [errors, setErrors] = useState<Errors>({})

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Errors = {}
    if (!date) next.date = 'Enter the date'
    let cents: number | undefined
    try {
      cents = parseDollars(amount)
      if (cents <= 0) next.amount = 'Enter the amount you got back as a positive number'
    } catch {
      next.amount = 'Enter an amount like 7.17'
    }
    if (destination === 'gift_card' && !chainId) {
      next.chain = 'Choose whose gift card got the money'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const input: CreditInput = {
      date,
      chain_id: chainId ? Number(chainId) : null,
      amount: cents!,
      destination,
      note: note.trim() || null,
    }
    try {
      await save.mutateAsync(input)
      navigate('/')
    } catch (error) {
      setErrors(fieldErrors(error, API_FIELDS))
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-xl flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          inputMode="decimal"
          placeholder="7.17"
        />
        <Field
          label="Date"
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          error={errors.date}
        />
      </div>
      <RadioGroup
        label="Refunded to"
        value={destination}
        options={DESTINATIONS}
        onChange={setDestination}
        error={errors.destination}
      />
      <SelectField
        label="Chain"
        value={chainId}
        onChange={(e) => setChainId(e.target.value)}
        options={[
          { value: '', label: destination === 'bank' ? 'No chain' : 'Choose a chain' },
          ...chains.map((c) => ({ value: String(c.id), label: c.name })),
        ]}
        error={errors.chain}
      />
      <Field
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={errors.note}
        maxLength={200}
        placeholder="What it was for"
      />
      {errors.form && (
        <p role="alert" className="text-sm text-warn">
          {errors.form}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className={primaryButton} disabled={save.isPending}>
          {id === undefined ? 'Save refund' : 'Save changes'}
        </button>
        <Link to="/" className={quietButton}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
