import type { ReactNode } from 'react'

/** Small caps title over a block of the form: the same title the grouped lists use. */
export function Section(props: { title: ReactNode; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-1.5">
            <h3 className="px-4 text-[12px] font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{props.title}</h3>
            {props.children}
        </section>
    )
}
