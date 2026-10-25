import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useChains, type Chain } from '../api/chains'
import { fieldErrors } from '../api/errors'
import {
  useGiftCard,
  useGiftCards,
  useSaveGiftCard,
  type GiftCard,
  type GiftCardInput,
} from '../api/giftCards'
import { primaryButton, quietButton } from '../components/buttons'
import { Field } from '../components/Field'
import { LoadProblem, NeedsChain } from '../components/LoadProblem'
import { Page } from '../components/Page'
import { SelectField } from '../components/SelectField'
import { todayIso } from '../lib/dates'
import { discountPercent, formatCents, parseDollars } from '../lib/money'

export function GiftCardFormPage({ mode }: { mode: 'new' | 'edit' }) {
  const params = useParams()
  const id = mode === 'edit' ? Number(params.id) : undefined
  const chains = useChains()
  const cards = useGiftCards()
  const card = useGiftCard(id)
  const title = mode === 'new' ? 'Add a gift card' : 'Edit gift card'

  if (card.isError) return <LoadProblem title={title} what="gift card" error={card.error} />
  if (chains.isError) return <LoadProblem title={title} what="gift card" error={chains.error} />
  if (chains.isPending || cards.isPending || (id !== undefined && card.isPending)) {
    return <Page title={title} intro="Loading…" />
  }
  if (chains.data.length === 0) return <NeedsChain title={title} what="Gift cards" />

  // Default to the chain you last bought a card for.
  const lastChainId = cards.data?.[0]?.chain_id ?? chains.data[0].id
  return (
    <Page title={title}>
      <GiftCardForm id={id} chains={chains.data} card={card.data} defaultChainId={lastChainId} />
    </Page>
  )
}

type FieldName = 'chain' | 'date' | 'paid' | 'face' | 'note'
type Errors = Partial<Record<FieldName | 'form', string>>

const API_FIELDS: Record<string, FieldName> = {
  chain_id: 'chain',
  date: 'date',
  price_paid: 'paid',
  face_value: 'face',
  note: 'note',
}

const dollars = (cents: number) => formatCents(cents).replace('$', '')

function tryPositiveCents(text: string): number | undefined {
  try {
    const cents = parseDollars(text)
    return cents > 0 ? cents : undefined
  } catch {
    return undefined
  }
}

type GiftCardFormProps = {
  id: number | undefined
  chains: Chain[]
  card: GiftCard | undefined
  defaultChainId: number
}

function GiftCardForm({ id, chains, card, defaultChainId }: GiftCardFormProps) {
  const navigate = useNavigate()
  const save = useSaveGiftCard(id)
  const [chainId, setChainId] = useState(String(card?.chain_id ?? defaultChainId))
  const [date, setDate] = useState(card?.date ?? todayIso())
  const [paid, setPaid] = useState(card ? dollars(card.price_paid) : '')
  const [face, setFace] = useState(card ? dollars(card.face_value) : '')
  const [note, setNote] = useState(card?.note ?? '')
  const [errors, setErrors] = useState<Errors>({})

  const paidCents = tryPositiveCents(paid)
  const faceCents = tryPositiveCents(face)
  const faceTooLow = paidCents !== undefined && faceCents !== undefined && faceCents < paidCents

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Errors = {}
    if (!date) next.date = 'Enter the date'
    if (paidCents === undefined) next.paid = 'Enter what you paid, like 35.00'
    if (faceCents === undefined) next.face = "Enter the card's value, like 50.00"
    else if (faceTooLow) next.face = "The card's value is less than you paid"
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const input: GiftCardInput = {
      chain_id: Number(chainId),
      date,
      price_paid: paidCents!,
      face_value: faceCents!,
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
      <div className="grid gap-6 sm:grid-cols-2">
        <SelectField
          label="Chain"
          value={chainId}
          onChange={(e) => setChainId(e.target.value)}
          options={chains.map((c) => ({ value: String(c.id), label: c.name }))}
          error={errors.chain}
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
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="You paid"
          value={paid}
          onChange={(e) => setPaid(e.target.value)}
          error={errors.paid}
          inputMode="decimal"
          placeholder="35.00"
        />
        <Field
          label="Card value"
          value={face}
          onChange={(e) => setFace(e.target.value)}
          // A too-low value shows below as you type; it becomes this field's error on save.
          error={errors.face}
          inputMode="decimal"
          placeholder="50.00"
        />
      </div>

      <div aria-live="polite" className="min-h-14">
        {paidCents !== undefined && faceCents !== undefined && (
          faceTooLow ? (
            !errors.face && <p className="text-warn">The card's value is less than you paid</p>
          ) : discountPercent(paidCents, faceCents) === 0 ? (
            <p className="text-dim">No discount</p>
          ) : (
            <div>
              <p className="money text-4xl leading-none">
                {discountPercent(paidCents, faceCents)}% off
              </p>
              <p className="mt-1 text-sm text-dim">
                {formatCents(faceCents - paidCents)} of extra balance
              </p>
            </div>
          )
        )}
      </div>

      <Field
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={errors.note}
        maxLength={200}
        placeholder="Where you bought it"
      />
      {errors.form && (
        <p role="alert" className="text-sm text-warn">
          {errors.form}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className={primaryButton} disabled={save.isPending}>
          {id === undefined ? 'Save gift card' : 'Save changes'}
        </button>
        <Link to="/" className={quietButton}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
