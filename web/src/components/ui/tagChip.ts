/** Session tag pill (list filters, tag picker): compact outline, filled when selected. 32px tall, 44px hit area. */
export function tagChipClass(selected: boolean): string {
    return `relative h-8 max-w-full shrink-0 truncate rounded-full border px-3 text-[13px] transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] ${selected
        ? 'border-[var(--social-primary)] bg-[var(--social-primary)] font-semibold text-[var(--social-primary-fg)]'
        : 'border-[var(--social-border)] text-[var(--social-fg)] hover:bg-[var(--social-hover)]'}`
}
