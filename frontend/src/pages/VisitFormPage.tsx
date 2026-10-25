import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useChains, type Chain } from '../api/chains'
import { fieldErrors } from '../api/errors'
import {
  useSaveVisit,
  useVisit,
  useVisits,
  type PaymentSource,
  type Visit,
  type VisitInput,
} from '../api/visits'
import { primaryButton, quietButton } from '../components/buttons'
import { Field } from '../components/Field'
import { LoadProblem, NeedsChain } from '../components/LoadProblem'
import { Page } from '../components/Page'
import { RadioGroup } from '../components/RadioGroup'
import { SelectField } from '../components/SelectField'
import { todayIso } from '../lib/dates'
import { formatCents, parseDollars } from '../lib/money'

const PAYMENT_OPTIONS: { value: PaymentSource; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'gift_card', label: 'Gift card' },
  { value: 'bank', label: 'Bank' },
]

export function VisitFormPage({ mode }: { mode: 'new' | 'edit' }) {
  const params = useParams()
  const id = mode === 'edit' ? Number(params.id) : undefined
  const chains = useChains()
  const visits = useVisits()
  const visit = useVisit(id)
  const title = mode === 'new' ? 'Log a visit' : 'Edit visit'

  if (visit.isError) return <LoadProblem title={title} what="visit" error={visit.error} />
  if (chains.isError) return <LoadProblem title={title} what="visit" error={chains.error} />
  if (chains.isPending || visits.isPending || (id !== undefined && visit.isPending)) {
    return <Page title={title} intro="Loading…" />
  }
  if (chains.data.length === 0) return <NeedsChain title={title} what="Visits" />

  // Default a new visit to wherever you went last.
  const lastChainId = visits.data?.[0]?.chain_id ?? chains.data[0].id
  return (
    <Page title={title}>
      <VisitForm id={id} chains={chains.data} visit={visit.data} defaultChainId={lastChainId} />
    </Page>
  )
}

type Errors = Partial<
  Record<'date' | 'chain' | 'film' | 'myCost' | 'guests' | 'guestCost' | 'payment' | 'note' | 'form', string>
>

// API field name → form field, for errors the server reports.
const API_FIELDS: Record<string, Exclude<keyof Errors, 'form'>> = {
  date: 'date',
  chain_id: 'chain',
  title: 'film',
  my_cost: 'myCost',
  guest_count: 'guests',
  guest_cost: 'guestCost',
  payment_source: 'payment',
  note: 'note',
}

const dollars = (cents: number) => formatCents(cents).replace('$', '')

/** Cents for a cost field, or undefined while it doesn't parse. */
function tryCents(text: string): number | undefined {
  try {
    return parseDollars(text)
  } catch {
    return undefined
  }
}

type VisitFormProps = {
  id: number | undefined
  chains: Chain[]
  visit: Visit | undefined
  defaultChainId: number
}

function VisitForm({ id, chains, visit, defaultChainId }: VisitFormProps) {
  const navigate = useNavigate()
  const save = useSaveVisit(id)

  const [date, setDate] = useState(visit?.date ?? todayIso())
  const [chainId, setChainId] = useState(String(visit?.chain_id ?? defaultChainId))
  const [film, setFilm] = useState(visit?.title ?? '')
  const [myCost, setMyCost] = useState(dollars(visit?.my_cost ?? 0))
  const [guests, setGuests] = useState(String(visit?.guest_count ?? 0))
  const [guestCost, setGuestCost] = useState(dollars(visit?.guest_cost ?? 0))
  const [note, setNote] = useState(visit?.note ?? '')
  // The payment source follows the costs (free at $0, gift card otherwise) until you pick one.
  const [chosenSource, setChosenSource] = useState<PaymentSource | undefined>(
    visit?.payment_source,
  )
  const [errors, setErrors] = useState<Errors>({})

  const total = (tryCents(myCost) ?? 0) + (tryCents(guestCost) ?? 0)
  const source: PaymentSource = chosenSource ?? (total === 0 ? 'free' : 'gift_card')

  function validate(): { input?: VisitInput; errors: Errors } {
    const next: Errors = {}
    if (!date) next.date = 'Enter the date'
    if (!film.trim()) next.film = 'Enter the film'
    const my = tryCents(myCost)
    if (my === undefined || my < 0) next.myCost = 'Enter an amount like 6.50'
    const guestCents = tryCents(guestCost)
    if (guestCents === undefined || guestCents < 0) next.guestCost = 'Enter an amount like 13.00'
    const guestCount = Number(guests)
    if (!Number.isInteger(guestCount) || guestCount < 0) next.guests = 'Enter a whole number'
    else if ((guestCents ?? 0) > 0 && guestCount === 0) next.guests = 'Enter how many guests'
    if (my !== undefined && guestCents !== undefined) {
      const cost = my + guestCents
      if (source === 'free' && cost > 0) next.payment = "A visit that cost something can't be free"
      if (source !== 'free' && cost === 0) next.payment = 'Choose Free for a $0 visit'
    }
    if (Object.keys(next).length > 0) return { errors: next }
    return {
      errors: next,
      input: {
        date,
        chain_id: Number(chainId),
        title: film.trim(),
        my_cost: my!,
        guest_count: guestCount,
        guest_cost: guestCents!,
        payment_source: source,
        note: note.trim() || null,
      },
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { input, errors: found } = validate()
    setErrors(found)
    if (!input) return
    try {
      await save.mutateAsync(input)
      navigate('/')
    } catch (error) {
      setErrors(fieldErrors(error, API_FIELDS))
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-xl flex-col gap-6">
      <Field
        label="Film"
        value={film}
        onChange={(e) => setFilm(e.target.value)}
        error={errors.film}
        maxLength={200}
        autoComplete="off"
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Date"
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          error={errors.date}
        />
        <SelectField
          label="Chain"
          value={chainId}
          onChange={(e) => setChainId(e.target.value)}
          options={chains.map((c) => ({ value: String(c.id), label: c.name }))}
          error={errors.chain}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field
          label="My ticket"
          value={myCost}
          onChange={(e) => setMyCost(e.target.value)}
          error={errors.myCost}
          inputMode="decimal"
        />
        <Field
          label="Guests"
          type="number"
          min={0}
          step={1}
          value={guests}
          onChange={(e) => setGuests(e.target.value)}
          error={errors.guests}
          inputMode="numeric"
        />
        <Field
          label="Guest tickets"
          value={guestCost}
          onChange={(e) => setGuestCost(e.target.value)}
          error={errors.guestCost}
          inputMode="decimal"
        />
      </div>
      <RadioGroup
        label="Paid with"
        value={source}
        options={PAYMENT_OPTIONS}
        onChange={setChosenSource}
        error={errors.payment}
      />
      <Field
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={errors.note}
        maxLength={200}
      />
      {errors.form && (
        <p role="alert" className="text-sm text-warn">
          {errors.form}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className={primaryButton} disabled={save.isPending}>
          {id === undefined ? 'Save visit' : 'Save changes'}
        </button>
        <Link to="/" className={quietButton}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
