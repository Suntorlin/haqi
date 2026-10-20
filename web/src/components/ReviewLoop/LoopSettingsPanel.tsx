import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/FormControls'
import type { ReviewLoopUserPreference } from '@/types/api'

type LoopSettingsPanelProps = {
    userPreference: ReviewLoopUserPreference
    maxRounds: number
    currentRound: number
    onUpdatePreference: (pref: ReviewLoopUserPreference) => void
    onUpdateMaxRounds: (n: number) => void
    disabled: boolean
}

const PREFERENCE_OPTIONS: Array<{ value: ReviewLoopUserPreference; label: string; description: string }> = [
    { value: 'auto', label: 'auto', description: 'Reviewer decides when to notify' },
    { value: 'verbose', label: 'verbose', description: 'Notify every round' },
    { value: 'silent', label: 'silent', description: 'Only on completion/failure' },
]

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
    const activeOption = PREFERENCE_OPTIONS.find((option) => option.value === userPreference)

    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
                <div className="px-1 text-footnote font-semibold text-[var(--social-fg-muted)]">Notify</div>
                <SegmentedControl
                    label="Notify"
                    value={userPreference}
                    options={PREFERENCE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    onChange={onUpdatePreference}
                    disabled={disabled}
                />
                {activeOption ? (
                    <p className="px-1 text-caption text-[var(--social-fg-subtle)]">{activeOption.description}</p>
                ) : null}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--social-divider)] pt-3">
                <span className="flex-1 px-1 text-body text-[var(--social-fg)]">Rounds</span>
                <IconButton
                    variant="muted"
                                        label="Fewer rounds"
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
                                        label="More rounds"
                    disabled={disabled}
                    onClick={() => onUpdateMaxRounds(maxRounds + 1)}
                >
                    <PlusGlyph className="h-4 w-4" />
                </IconButton>
            </div>
        </div>
    )
}
