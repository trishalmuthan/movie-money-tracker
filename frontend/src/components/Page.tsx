import type { ReactNode } from 'react'

/** A page's title and intro. Every route renders one, so each page has exactly one h1. */
export function Page({ title, intro, children }: { title: string; intro?: ReactNode; children?: ReactNode }) {
  return (
    <section>
      <h1 className="font-display text-5xl leading-none font-bold tracking-tight md:text-6xl">
        {title}
      </h1>
      {intro && <p className="mt-4 max-w-prose text-dim">{intro}</p>}
      {children && <div className="mt-8">{children}</div>}
    </section>
  )
}
