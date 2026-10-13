/** Session tag pill (list filters, tag picker): compact outline, filled when selected. */
export function tagChipClass(selected: boolean): string {
    return `h-7 max-w-full shrink-0 truncate rounded-full border px-2.5 text-[12.5px] transition-colors ${selected
        ? 'border-[var(--social-primary)] bg-[var(--social-primary)] text-[var(--social-primary-fg)]'
        : 'border-[var(--social-border)] text-[var(--social-fg)] hover:bg-[var(--social-hover)]'}`
}
