import { useState } from 'react'
import { Field } from '../../components/Field'
import { formatCents, parseDollars } from '../../lib/money'

type MoneyFieldProps = {
  label: string
  cents: number
  onCommit: (cents: number) => void
  error?: string
  className?: string
}

/** A dollar amount that's sent (as cents) when you leave the field, not on every keystroke. */
export function MoneyField({ label, cents, onCommit, error, className = 'w-32' }: MoneyFieldProps) {
  const [text, setText] = useState(formatCents(cents).replace('$', ''))
  const [invalid, setInvalid] = useState(false)

  function commit() {
    try {
      const value = parseDollars(text)
      if (value < 0) throw new Error('negative')
      setInvalid(false)
      if (value !== cents) onCommit(value)
    } catch {
      setInvalid(true)
    }
  }

  return (
    <Field
      label={label}
      value={text}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      error={invalid ? 'Enter an amount like 6.50' : error}
      className={className}
    />
  )
}
