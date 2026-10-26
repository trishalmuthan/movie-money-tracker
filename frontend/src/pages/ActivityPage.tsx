import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  useActivity,
  useDeleteEntry,
  useWallets,
  type ActivityFilters,
  type EntryKind,
  type Wallet,
} from '../api/activity'
import { useChains, type Chain } from '../api/chains'
import { errorMessage } from '../api/errors'
import { dangerButton, quietButton } from '../components/buttons'
import { Page } from '../components/Page'
import { cashOut, groupByMonth, type ActivityEntry } from '../lib/activity'
import { monthLabel, shortDate } from '../lib/dates'
import { formatCents } from '../lib/money'

const KINDS: { value: EntryKind; label: string; singular: string }[] = [
  { value: 'visit', label: 'Visits', singular: 'Visit' },
  { value: 'fee', label: 'Fees', singular: 'Fee' },
  { value: 'gift_card', label: 'Gift cards', singular: 'Gift card' },
  { value: 'credit', label: 'Refunds', singular: 'Refund' },
]

const EDIT_PATH: Record<EntryKind, string> = {
  visit: 'visits',
  fee: 'fees',
  gift_card: 'gift-cards',
  credit: 'credits',
}

/** Filters live in the URL, so a reload or a shared link keeps them. */
function useFilters() {
  const [params, setParams] = useSearchParams()
  const kind = params.get('kind')
  const filters: ActivityFilters = {
    kind: KINDS.some((k) => k.value === kind) ? (kind as EntryKind) : undefined,
    chainId: params.get('chain') ? Number(params.get('chain')) : undefined,
    month: params.get('month') || undefined,
  }
  function setFilter(name: 'kind' | 'chain' | 'month', value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(name, value)
      else next.delete(name)
      return next
    })
  }
  const active = Boolean(filters.kind || filters.chainId || filters.month)
  return { filters, setFilter, active, clear: () => setParams({}) }
}

export function ActivityPage() {
  const { filters, setFilter, active, clear } = useFilters()
  const chains = useChains()
  const activity = useActivity(filters)
  const chainNames = new Map((chains.data ?? []).map((c) => [c.id, c.name]))

  return (
    <Page title="Activity">
      <WalletStrip />
      <Filters chains={chains.data ?? []} filters={filters} onChange={setFilter} />

      <div className="mt-8">
        {activity.isPending ? (
          <p className="text-dim">Loading…</p>
        ) : activity.isError ? (
          <p role="alert" className="text-warn">
            {errorMessage(activity.error)}
          </p>
        ) : activity.data.length === 0 ? (
          active ? (
            <div className="flex items-center gap-4">
              <p>Nothing matches these filters.</p>
              <button type="button" className={quietButton} onClick={clear}>
                Clear filters
              </button>
            </div>
          ) : (
            <div>
              <p>Nothing logged yet.</p>
              <p className="mt-2 text-dim">
                <Link to="/visits/new" className="text-brass underline underline-offset-4">
                  Log a visit
                </Link>{' '}
                or{' '}
                <Link to="/gift-cards/new" className="text-brass underline underline-offset-4">
                  Add a gift card
                </Link>{' '}
                to get started.
              </p>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-10">
            {groupByMonth(activity.data).map((group) => (
              <MonthSection
                key={group.month}
                month={group.month}
                entries={group.entries}
                chainNames={chainNames}
              />
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}

function WalletStrip() {
  const wallets = useWallets()
  if (!wallets.data || wallets.data.length === 0) return null
  return (
    <section aria-label="Gift card balances" className="mb-8 flex flex-wrap gap-x-10 gap-y-4">
      {wallets.data.map((wallet) => (
        <WalletBalance key={wallet.chain_id} wallet={wallet} />
      ))}
    </section>
  )
}

function WalletBalance({ wallet }: { wallet: Wallet }) {
  return (
    <div>
      <p className="text-sm text-dim">{wallet.chain_name}</p>
      <p className={`money text-4xl leading-tight ${wallet.balance < 0 ? 'text-warn' : ''}`}>
        {formatCents(wallet.balance)}
      </p>
      {wallet.uncovered > 0 && (
        <p className="text-sm text-warn">
          {formatCents(wallet.uncovered)} not covered by gift card balance
        </p>
      )}
      {/* Runway: only for a gift-card-paid subscription, and not on top of an uncovered warning. */}
      {wallet.runway_months !== null && wallet.uncovered === 0 && wallet.balance >= 0 && (
        wallet.runway_months === 0 ? (
          <p className="text-sm text-warn">Not enough for next month's fee</p>
        ) : (
          <p className="text-sm text-dim">
            Covers about {wallet.runway_months} more month{wallet.runway_months === 1 ? '' : 's'}
          </p>
        )
      )}
    </div>
  )
}

type FiltersProps = {
  chains: Chain[]
  filters: ActivityFilters
  onChange: (name: 'kind' | 'chain' | 'month', value: string) => void
}

const filterControl =
  'rounded-md border border-velvet bg-house-raised px-3 py-2 text-sm text-screen'

function Filters({ chains, filters, onChange }: FiltersProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-sm text-dim">
        Type
        <select
          className={filterControl}
          value={filters.kind ?? ''}
          onChange={(e) => onChange('kind', e.target.value)}
        >
          <option value="">All types</option>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {chains.length > 1 && (
        <label className="flex flex-col gap-1 text-sm text-dim">
          Chain
          <select
            className={filterControl}
            value={filters.chainId ?? ''}
            onChange={(e) => onChange('chain', e.target.value)}
          >
            <option value="">All chains</option>
            {chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm text-dim">
        Month
        <input
          type="month"
          className={filterControl}
          value={filters.month ?? ''}
          onChange={(e) => onChange('month', e.target.value)}
        />
      </label>
    </div>
  )
}

type MonthSectionProps = {
  month: string
  entries: ActivityEntry[]
  chainNames: Map<number, string>
}

function MonthSection({ month, entries, chainNames }: MonthSectionProps) {
  const headingId = `month-${month}`
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between border-b border-velvet pb-2">
        <h2 id={headingId} className="font-display text-3xl font-bold">
          {monthLabel(month)}
        </h2>
        <p className="text-sm text-dim">Cash out {formatCents(cashOut(entries))}</p>
      </div>
      <ul className="divide-y divide-velvet/50">
        {entries.map((entry) => (
          <EntryRow key={`${entry.kind}-${entry.id}`} entry={entry} chainNames={chainNames} />
        ))}
      </ul>
    </section>
  )
}

/** For a fee the plan doesn't update: whether the sheet or you set it. A skipped month already says why. */
function whoSetIt(entry: ActivityEntry): string | undefined {
  if (entry.amount === 0) return undefined
  if (entry.from_sheet) return 'from your sheet'
  return entry.is_overridden ? 'edited' : undefined
}

function describeSource(entry: ActivityEntry): string | undefined {
  // A $0 fee is a month you skipped; it moved no money, so how it was paid doesn't matter.
  if (entry.kind === 'fee' && entry.amount === 0) return 'Skipped'
  if (entry.kind === 'visit' || entry.kind === 'fee') {
    return { free: 'Free', gift_card: 'Paid with gift card', bank: 'Paid by bank' }[
      entry.payment_source ?? ''
    ]
  }
  if (entry.kind === 'credit') {
    return entry.payment_source === 'gift_card' ? 'Back onto gift card' : 'Back to bank'
  }
  return undefined
}

function EntryRow({ entry, chainNames }: { entry: ActivityEntry; chainNames: Map<number, string> }) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteEntry()
  const kindLabel = KINDS.find((k) => k.value === entry.kind)!.singular
  const meta = [
    kindLabel,
    entry.chain_id !== null ? chainNames.get(entry.chain_id) : undefined,
    describeSource(entry),
    whoSetIt(entry),
  ].filter(Boolean)
  // A fee belongs to its subscription: edit it (or set it to $0), never delete it.
  const deletable = entry.kind === 'fee' ? null : { kind: entry.kind, id: entry.id }
  const differs = entry.effective_cost !== null && entry.effective_cost !== entry.amount

  return (
    <li aria-label={entry.description} className="flex gap-4 py-3">
      <p className="w-14 shrink-0 pt-0.5 text-sm text-dim">{shortDate(entry.date)}</p>
      <div className="min-w-0 flex-1">
        <p className="break-words">{entry.description}</p>
        <p className="text-sm text-dim">{meta.join(', ')}</p>
        <div className="-ml-2 flex flex-wrap items-center gap-1">
          {confirming ? (
            <>
              <span className="ml-2 text-sm">Delete this {kindLabel.toLowerCase()}?</span>
              <button
                type="button"
                className={dangerButton}
                disabled={remove.isPending}
                onClick={() => remove.mutate(deletable!)}
              >
                Yes, delete
              </button>
              <button type="button" className={quietButton} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <>
              <Link
                to={`/${EDIT_PATH[entry.kind]}/${entry.id}/edit`}
                className={quietButton}
                aria-label={`Edit ${entry.description}`}
              >
                Edit
              </Link>
              {deletable && (
                <button
                  type="button"
                  className={quietButton}
                  aria-label={`Delete ${entry.description}`}
                  onClick={() => {
                    remove.reset()
                    setConfirming(true)
                  }}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
        {remove.isError && (
          <p role="alert" className="text-sm text-warn">
            {errorMessage(remove.error)}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        {/* Brass is for money that moved; a $0 visit or skipped fee stays quiet. */}
        <p className={`money text-2xl leading-none ${entry.amount === 0 ? 'text-dim' : ''}`}>
          {formatCents(entry.amount)}
        </p>
        {differs && (
          <p className="mt-1 text-sm text-dim">really {formatCents(entry.effective_cost!)}</p>
        )}
      </div>
    </li>
  )
}
