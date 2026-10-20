function getProgressColor(progress: number): string {
    if (progress < 30) return 'var(--app-badge-error-text)'
    if (progress <= 70) return 'var(--app-badge-warning-text)'
    return 'var(--app-badge-success-text)'
}

export function ProgressBar({ progress }: { progress: number }) {
    const clamped = Math.max(0, Math.min(100, progress))
    const color = getProgressColor(clamped)

    return (
        <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clamped}
            className="flex min-w-0 max-w-full items-center gap-3"
        >
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--social-muted)]">
                <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${clamped}%`, backgroundColor: color }}
                />
            </div>
            <span className="w-10 shrink-0 text-right text-footnote tabular-nums text-[var(--social-fg-muted)]">{clamped}%</span>
        </div>
    )
}
