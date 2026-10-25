import { useId } from 'react'

type RadioGroupProps<T extends string> = {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  error?: string
}

/** A row of mutually exclusive choices, shown as joined pills. */
export function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  error,
}: RadioGroupProps<T>) {
  const name = useId()
  const errorId = `${name}-error`
  return (
    <fieldset aria-describedby={error ? errorId : undefined} className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm text-dim">{label}</legend>
      <div className="flex w-fit overflow-hidden rounded-full border border-velvet">
        {options.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer px-4 py-2 text-sm text-dim has-checked:bg-velvet has-checked:text-screen has-focus-visible:outline-2 has-focus-visible:outline-brass"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="text-sm text-warn">
          {error}
        </p>
      )}
    </fieldset>
  )
}
