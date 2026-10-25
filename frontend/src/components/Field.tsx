import { useId, type InputHTMLAttributes } from 'react'

type FieldProps = { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>

/** A labelled text input whose error is announced and tied to the input. */
export function Field({ label, error, className = '', ...input }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm text-dim">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded-md border border-velvet bg-house-raised px-3 py-2 text-screen placeholder:text-dim/60 aria-invalid:border-warn"
        {...input}
      />
      {error && (
        <p id={errorId} className="text-sm text-warn">
          {error}
        </p>
      )}
    </div>
  )
}
