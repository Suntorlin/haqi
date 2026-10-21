import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

/**
 * Bottom bar on a finished report: approve, or ask for changes.
 * Pass `verdict` after the user decided to replace the buttons with a status line.
 */
export function VerdictBar(props: { onApprove: () => void; onRequestChanges: () => void; verdict?: ReactNode }) {
    const { t } = useTranslation()
    return (
        <div className="social-bar shrink-0 border-t border-[var(--social-border)] px-4 pb-[calc(var(--safe-bottom)+10px)] pt-2.5">
            {/* On a wide screen the two buttons stay button-sized, centred under the report. */}
            <div className="mx-auto flex w-full max-w-md gap-2">
                {props.verdict ? (
                    <div className="flex h-11 flex-1 items-center justify-center text-body text-[var(--social-fg)]">{props.verdict}</div>
                ) : (
                    <>
                        <Button variant="secondary" className="flex-1" onClick={props.onRequestChanges}>{t('report.verdict.change')}</Button>
                        <Button className="flex-1" onClick={props.onApprove}>{t('report.verdict.approve')}</Button>
                    </>
                )}
            </div>
        </div>
    )
}
