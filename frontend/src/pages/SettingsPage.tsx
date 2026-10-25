import { useState, type FormEvent } from 'react'
import {
  useChains,
  useCreateChain,
  useDeleteChain,
  useUpdateChain,
  type Chain,
  type ChainInput,
} from '../api/chains'
import { ApiError, errorMessage } from '../api/errors'
import { dangerButton, primaryButton, quietButton, secondaryButton } from '../components/buttons'
import { Field } from '../components/Field'
import { Page } from '../components/Page'
import { formatCents, parseDollars } from '../lib/money'

export function SettingsPage() {
  return (
    <Page title="Settings">
      <ChainsSection />
    </Page>
  )
}

function ChainsSection() {
  const chains = useChains()
  const create = useCreateChain()

  return (
    <section aria-labelledby="chains-heading" className="max-w-2xl">
      <h2 id="chains-heading" className="font-display text-3xl font-bold">
        Theatre chains
      </h2>
      <p className="mt-2 text-dim">
        The ticket price is what one standard adult ticket costs at that chain. It's used to show
        how much your subscription saves you.
      </p>

      {chains.isPending ? (
        <p className="mt-6 text-dim">Loading chains…</p>
      ) : chains.isError ? (
        <p role="alert" className="mt-6 text-warn">
          {errorMessage(chains.error)}
        </p>
      ) : chains.data.length === 0 ? (
        <p className="mt-6">No chains yet. Add the theatre chain you go to below.</p>
      ) : (
        <ul className="mt-6 divide-y divide-velvet/60 border-y border-velvet/60">
          {chains.data.map((chain) => (
            <ChainRow key={chain.id} chain={chain} />
          ))}
        </ul>
      )}

      <div className="mt-8">
        <h3 className="mb-3 font-semibold">Add a chain</h3>
        <ChainForm
          submitLabel="Add chain"
          resetOnSuccess
          onSubmit={(input) => create.mutateAsync(input)}
        />
      </div>
    </section>
  )
}

type RowMode = 'view' | 'edit' | 'confirm-delete'

function ChainRow({ chain }: { chain: Chain }) {
  const [mode, setMode] = useState<RowMode>('view')
  const update = useUpdateChain()
  const remove = useDeleteChain()

  return (
    <li aria-label={chain.name} className="py-4">
      {mode === 'edit' ? (
        <ChainForm
          initial={chain}
          submitLabel="Save"
          onSubmit={async (input) => {
            await update.mutateAsync({ id: chain.id, body: input })
            setMode('view')
          }}
          onCancel={() => setMode('view')}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-4">
            <span className="text-lg">{chain.name}</span>
            <span className="money text-2xl">{formatCents(chain.standard_ticket_price)}</span>
          </div>
          {mode === 'view' ? (
            <div className="flex gap-1">
              <button
                type="button"
                className={quietButton}
                aria-label={`Edit ${chain.name}`}
                onClick={() => setMode('edit')}
              >
                Edit
              </button>
              <button
                type="button"
                className={quietButton}
                aria-label={`Delete ${chain.name}`}
                onClick={() => {
                  remove.reset()
                  setMode('confirm-delete')
                }}
              >
                Delete
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm">Delete {chain.name}?</span>
              <button
                type="button"
                className={dangerButton}
                disabled={remove.isPending}
                onClick={() => remove.mutate(chain.id)}
              >
                Yes, delete
              </button>
              <button type="button" className={quietButton} onClick={() => setMode('view')}>
                Keep it
              </button>
            </div>
          )}
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

type ChainFormProps = {
  initial?: Chain
  submitLabel: string
  resetOnSuccess?: boolean
  onSubmit: (input: ChainInput) => Promise<unknown>
  onCancel?: () => void
}

/** Add or edit a chain. Prices are typed in dollars and sent as cents. */
function ChainForm({ initial, submitLabel, resetOnSuccess, onSubmit, onCancel }: ChainFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [price, setPrice] = useState(
    initial ? formatCents(initial.standard_ticket_price).replace('$', '') : '',
  )
  const [errors, setErrors] = useState<{ name?: string; price?: string; form?: string }>({})
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const next: typeof errors = {}
    if (!name.trim()) next.name = 'Enter a name'
    let cents: number | undefined
    try {
      cents = parseDollars(price)
      if (cents < 0) next.price = "A ticket price can't be negative"
    } catch {
      next.price = 'Enter an amount like 15.00'
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || cents === undefined) return

    setSaving(true)
    try {
      await onSubmit({ name: name.trim(), standard_ticket_price: cents })
      if (resetOnSuccess) {
        setName('')
        setPrice('')
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setErrors({ name: error.message })
      } else if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
        setErrors({ name: error.fields.name, price: error.fields.standard_ticket_price })
      } else {
        setErrors({ form: errorMessage(error) })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-wrap items-start gap-3">
      <Field
        label="Chain name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        maxLength={80}
        className="min-w-48 flex-1"
      />
      <Field
        label="Ticket price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        error={errors.price}
        inputMode="decimal"
        placeholder="15.00"
        className="w-32"
      />
      <div className="flex gap-2 self-end pb-0.5">
        <button type="submit" className={onCancel ? secondaryButton : primaryButton} disabled={saving}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={quietButton} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {errors.form && (
        <p role="alert" className="w-full text-sm text-warn">
          {errors.form}
        </p>
      )}
    </form>
  )
}
