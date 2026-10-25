/** Session tag pill (list filters, tag picker): compact outline, filled when selected. 32px tall, 44px hit area. Put the text in <FitText kind="label" lines={1}>. */
export function tagChipClass(selected: boolean): string {
    return `relative inline-flex h-8 max-w-full shrink-0 items-center rounded-full border px-3 text-footnote transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] ${selected
        ? 'border-[var(--social-primary)] bg-[var(--social-primary)] font-semibold text-[var(--social-primary-fg)]'
        : 'border-[var(--social-border)] text-[var(--social-fg)] hover:bg-[var(--social-hover)]'}`
}
