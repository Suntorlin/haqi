import { useEffect, useMemo, useState } from 'react'
import type { ReviewLoopUserPreference, SessionSummary } from '@/types/api'
import { BottomSheet, SheetSection } from '@/components/mobile/BottomSheet'
import { SessionAvatar, getProjectName, getSessionProjectPath } from '@/components/mobile/SessionAvatar'
import { ChevronRightIcon, SearchIcon } from '@/components/mobile/icons'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { Button } from '@/components/ui/button'
import { matchesSessionSearch } from '@/lib/session-search'
import { getSessionTitle } from '@/lib/session-title'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export type CreateLoopData = {
    workerSessionId: string
    reviewerSessionId: string
    requirement: string
    acceptanceCriteria: string
    maxRounds: number
    userPreference: ReviewLoopUserPreference
}

type CreateLoopModalProps = {
    open: boolean
    onClose: () => void
    onSubmit: (data: CreateLoopData) => void
    sessions: SessionSummary[]
}

const PREFERENCES: ReviewLoopUserPreference[] = ['auto', 'verbose', 'silent']

/** Session row: tap to expand a searchable list (online first), pick one to collapse again. */
function SessionPicker(props: {
    label: string
    sessions: SessionSummary[]
    excludeId?: string
    selectedId: string
    onSelect: (id: string) => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const selected = props.sessions.find((session) => session.id === props.selectedId) ?? null
    const candidates = useMemo(() => props.sessions
        .filter((session) => session.id !== props.excludeId && matchesSessionSearch(session, search))
        .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)
        .slice(0, 60), [props.sessions, props.excludeId, search])

    return (
        <SheetSection title={props.label}>
            <button
                type="button"
                onClick={() => {
                    setSearch('')
                    setOpen((value) => !value)
                }}
                className="social-pressable flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left"
                aria-expanded={open}
            >
                {selected ? <SessionAvatar session={selected} size={30} muted={!selected.active} /> : null}
                <span className={cn('min-w-0 flex-1 truncate text-[15px]', selected ? 'text-[var(--social-fg)]' : 'text-[var(--social-fg-subtle)]')}>
                    {selected ? getSessionTitle(selected, { fallbackIdLength: 12 }) : t('loops.create.pickSession')}
                </span>
                <ChevronRightIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', open ? 'rotate-90' : '')} />
            </button>
            {open ? (
                <div className="border-t border-[var(--social-border)]">
                    <label className="flex items-center gap-2 px-4 py-2 text-[var(--social-fg-subtle)]">
                        <SearchIcon className="h-4 w-4 shrink-0" />
                        <input
                            autoFocus
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('sessions.search.placeholder')}
                            className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--social-fg)] outline-none placeholder:text-[var(--social-fg-subtle)]"
                        />
                    </label>
                    <div className="max-h-64 overflow-y-auto border-t border-[var(--social-border)]">
                        {candidates.length === 0 ? (
                            <div className="px-4 py-3 text-[14px] text-[var(--social-fg-muted)]">{t('loops.create.noMatch')}</div>
                        ) : candidates.map((session) => (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => {
                                    props.onSelect(session.id)
                                    setOpen(false)
                                }}
                                aria-current={session.id === props.selectedId ? 'true' : undefined}
                                className="social-pressable flex w-full items-center gap-3 px-4 py-2 text-left aria-[current=true]:bg-[var(--social-muted)]"
                            >
                                <SessionAvatar session={session} size={28} muted={!session.active} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[14px] text-[var(--social-fg)]">{getSessionTitle(session, { fallbackIdLength: 12 })}</span>
                                    <span className="block truncate text-[12px] text-[var(--social-fg-muted)]">
                                        {getProjectName(getSessionProjectPath(session))}
                                        {session.active ? '' : ` · ${t('misc.offline')}`}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </SheetSection>
    )
}

export function CreateLoopModal({ open, onClose, onSubmit, sessions }: CreateLoopModalProps) {
    const { t } = useTranslation()
    const [workerSessionId, setWorkerSessionId] = useState('')
    const [reviewerSessionId, setReviewerSessionId] = useState('')
    const [requirement, setRequirement] = useState('')
    const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
    const [maxRounds, setMaxRounds] = useState(10)
    const [userPreference, setUserPreference] = useState<ReviewLoopUserPreference>('auto')

    useEffect(() => {
        if (open) {
            setWorkerSessionId('')
            setReviewerSessionId('')
            setRequirement('')
            setAcceptanceCriteria('')
            setMaxRounds(10)
            setUserPreference('auto')
        }
    }, [open])

    const isValid = workerSessionId !== ''
        && reviewerSessionId !== ''
        && workerSessionId !== reviewerSessionId
        && requirement.trim() !== ''
        && acceptanceCriteria.trim() !== ''
        && maxRounds >= 1

    const handleSubmit = () => {
        if (!isValid) return
        onSubmit({
            workerSessionId,
            reviewerSessionId,
            requirement: requirement.trim(),
            acceptanceCriteria: acceptanceCriteria.trim(),
            maxRounds,
            userPreference
        })
    }

    return (
        <BottomSheet open={open} onOpenChange={(value) => !value && onClose()} title={t('mobile.loops.new')}>
            <div className="pt-1">
                <SessionPicker
                    label={t('loops.create.worker')}
                    sessions={sessions}
                    selectedId={workerSessionId}
                    onSelect={(id) => {
                        setWorkerSessionId(id)
                        if (id === reviewerSessionId) setReviewerSessionId('')
                    }}
                />
                <SessionPicker
                    label={t('loops.create.reviewer')}
                    sessions={sessions}
                    excludeId={workerSessionId}
                    selectedId={reviewerSessionId}
                    onSelect={setReviewerSessionId}
                />

                <div className="flex flex-col gap-3 px-4 pb-3">
                    <label className="flex flex-col gap-1.5">
                        <span className="px-1 text-[12px] font-medium text-[var(--social-fg-muted)]">{t('loops.create.requirement')}</span>
                        <textarea
                            value={requirement}
                            onChange={(event) => setRequirement(event.target.value)}
                            placeholder={t('loops.create.requirementPlaceholder')}
                            rows={3}
                            className={cn(DIALOG_INPUT_CLASS, 'resize-none')}
                        />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className="px-1 text-[12px] font-medium text-[var(--social-fg-muted)]">{t('loops.create.criteria')}</span>
                        <textarea
                            value={acceptanceCriteria}
                            onChange={(event) => setAcceptanceCriteria(event.target.value)}
                            placeholder={t('loops.create.criteriaPlaceholder')}
                            rows={3}
                            className={cn(DIALOG_INPUT_CLASS, 'resize-none')}
                        />
                    </label>
                </div>

                <SheetSection>
                    <div className="flex min-h-[48px] items-center gap-3 px-4 py-2">
                        <span className="flex-1 text-[15px] text-[var(--social-fg)]">{t('loops.create.maxRounds')}</span>
                        <input
                            type="number"
                            min={1}
                            max={100}
                            value={maxRounds}
                            onChange={(event) => setMaxRounds(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
                            className="w-20 rounded-lg border border-[var(--social-border)] bg-[var(--app-bg)] px-2 py-1.5 text-center text-[15px] tabular-nums text-[var(--social-fg)] outline-none focus:border-[var(--social-fg-subtle)]"
                        />
                    </div>
                </SheetSection>

                <SheetSection title={t('loops.create.notify')}>
                    <div className="flex gap-1 bg-[var(--social-muted)] p-1">
                        {PREFERENCES.map((preference) => (
                            <button
                                key={preference}
                                type="button"
                                onClick={() => setUserPreference(preference)}
                                className={cn(
                                    'flex-1 rounded-[10px] py-2 text-[14px] transition-colors',
                                    userPreference === preference
                                        ? 'bg-[var(--app-bg)] font-medium text-[var(--social-fg)] shadow-sm'
                                        : 'text-[var(--social-fg-muted)] hover:text-[var(--social-fg)]'
                                )}
                            >
                                {t(`loops.create.notify.${preference}`)}
                            </button>
                        ))}
                    </div>
                </SheetSection>

                <div className="flex justify-end gap-2 px-4 pb-4 pt-1">
                    <Button type="button" variant="secondary" onClick={onClose}>
                        {t('button.cancel')}
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={!isValid}>
                        {t('newSession.create')}
                    </Button>
                </div>
            </div>
        </BottomSheet>
    )
}
