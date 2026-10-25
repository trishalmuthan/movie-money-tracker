import { useId, type SelectHTMLAttributes } from 'react'

type SelectFieldProps = {
  label: string
  error?: string
  options: { value: string; label: string }[]
} & SelectHTMLAttributes<HTMLSelectElement>

/** A labelled dropdown, styled and wired for errors like Field. */
export function SelectField({ label, error, options, className = '', ...select }: SelectFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm text-dim">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded-md border border-velvet bg-house-raised px-3 py-2 text-screen aria-invalid:border-warn"
        {...select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="text-sm text-warn">
          {error}
        </p>
      )}
    </div>
  )
}
