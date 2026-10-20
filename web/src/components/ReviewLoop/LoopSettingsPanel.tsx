import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'
import type { ReviewLoopUserPreference } from '@/types/api'

type LoopSettingsPanelProps = {
    userPreference: ReviewLoopUserPreference
    maxRounds: number
    currentRound: number
    onUpdatePreference: (pref: ReviewLoopUserPreference) => void
    onUpdateMaxRounds: (n: number) => void
    disabled: boolean
}

const PREFERENCES: ReviewLoopUserPreference[] = ['auto', 'verbose', 'silent']

function MinusIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function PlusGlyph({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
            <line x1="12" y1="5" x2="12" y2="19" />
        </svg>
    )
}

export function LoopSettingsPanel({
    userPreference,
    maxRounds,
    currentRound,
    onUpdatePreference,
    onUpdateMaxRounds,
    disabled,
}: LoopSettingsPanelProps) {
    const { t } = useTranslation()

    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
                <div className="px-1 text-footnote font-semibold text-[var(--social-fg-muted)]">{t('loops.create.notify')}</div>
                <SegmentedControl
                    label={t('loops.create.notify')}
                    value={userPreference}
                    options={PREFERENCES.map((preference) => ({ value: preference, label: t(`loops.create.notify.${preference}`) }))}
                    onChange={onUpdatePreference}
                    disabled={disabled}
                />
                {PREFERENCES.includes(userPreference) ? (
                    <p className="px-1 text-caption text-[var(--social-fg-subtle)]">{t(`loops.notify.${userPreference}Hint`)}</p>
                ) : null}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--social-divider)] pt-3">
                <span className="flex-1 px-1 text-body text-[var(--social-fg)]">{t('loops.create.maxRounds')}</span>
                <IconButton
                    variant="muted"
                    label={t('loops.settings.fewerRounds')}
                    disabled={disabled || maxRounds <= 1}
                    onClick={() => onUpdateMaxRounds(maxRounds - 1)}
                >
                    <MinusIcon className="h-4 w-4" />
                </IconButton>
                <span className="min-w-[4ch] text-center text-body tabular-nums text-[var(--social-fg)]">
                    {currentRound}/{maxRounds}
                </span>
                <IconButton
                    variant="muted"
                    label={t('loops.settings.moreRounds')}
                    disabled={disabled}
                    onClick={() => onUpdateMaxRounds(maxRounds + 1)}
                >
                    <PlusGlyph className="h-4 w-4" />
                </IconButton>
            </div>
        </div>
    )
}
