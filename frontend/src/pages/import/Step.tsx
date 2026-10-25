import { useId, type ReactNode } from 'react'

/** One numbered step of the import. The steps really are a sequence, so they're numbered. */
export function Step({ number, title, intro, children }: { number: number; title: string; intro?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="flex items-baseline gap-3 font-display text-3xl font-bold">
        <span className="money text-2xl">{number}</span>
        {title}
      </h2>
      {intro && <p className="mt-2 max-w-prose text-dim">{intro}</p>}
      <div className="mt-6">{children}</div>
    </section>
  )
}
