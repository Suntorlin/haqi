import type { ReactNode } from 'react'
import { ChevronLeftIcon } from '@/components/mobile/icons'
import { useTranslation } from '@/lib/use-translation'

/** Round icon button for sub-page header actions. */
export function SubPageHeaderButton(props: { label: string; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--social-fg-muted)] transition-colors hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)] [-webkit-tap-highlight-color:transparent]"
            title={props.label}
            aria-label={props.label}
        >
            {props.children}
        </button>
    )
}

/** Header of second-level pages (new session, files, file, terminal, preview): back, title, actions. */
export function SubPageHeader(props: { title: ReactNode; subtitle?: ReactNode; onBack?: () => void; actions?: ReactNode }) {
    const { t } = useTranslation()
    return (
        <header className="social-bar relative z-20 shrink-0 border-b border-[var(--social-border)] pt-[env(safe-area-inset-top)]">
            <div className="flex h-[54px] items-center gap-1 pl-1 pr-3 lg:h-[60px] lg:pl-2 lg:pr-4">
                {props.onBack ? (
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--social-fg)] transition-colors hover:bg-[var(--social-muted)] [-webkit-tap-highlight-color:transparent]"
                        aria-label={t('button.back')}
                    >
                        <ChevronLeftIcon className="h-6 w-6" />
                    </button>
                ) : (
                    <span className="w-3 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-[var(--social-fg)]">
                        {props.title}
                    </div>
                    {props.subtitle ? (
                        <div className="mt-0.5 truncate text-[12px] leading-tight text-[var(--social-fg-muted)]">{props.subtitle}</div>
                    ) : null}
                </div>
                {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
            </div>
        </header>
    )
}
