import { useEffect, useId, useMemo, useState } from 'react'
import type { ReviewLoopUserPreference, SessionSummary } from '@/types/api'
import { BottomSheet, SheetSection } from '@/components/mobile/BottomSheet'
import { SessionAvatar, getProjectName, getSessionProjectPath } from '@/components/mobile/SessionAvatar'
import { ChevronRightIcon, SearchIcon } from '@/components/mobile/icons'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { Button } from '@/components/ui/button'
import { FormField, SegmentedControl } from '@/components/ui/FormControls'
import { TextField } from '@/components/ui/TextField'
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
                <span className={cn('min-w-0 flex-1 truncate text-body', selected ? 'text-[var(--social-fg)]' : 'text-[var(--social-fg-subtle)]')}>
                    {selected ? getSessionTitle(selected, { fallbackIdLength: 12 }) : t('loops.create.pickSession')}
                </span>
                <ChevronRightIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', open ? 'rotate-90' : '')} />
            </button>
            {open ? (
                <div className="border-t border-[var(--social-border)]">
                    <div className="px-3 py-2">
                        <TextField
                            variant="pill"
                            autoFocus
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('sessions.search.placeholder')}
                            aria-label={t('sessions.search.placeholder')}
                            leading={<SearchIcon className="h-4 w-4" />}
                        />
                    </div>
                    <div className="max-h-64 overflow-y-auto border-t border-[var(--social-border)]">
                        {candidates.length === 0 ? (
                            <div className="px-4 py-3 text-body text-[var(--social-fg-muted)]">{t('loops.create.noMatch')}</div>
                        ) : candidates.map((session) => (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => {
                                    props.onSelect(session.id)
                                    setOpen(false)
                                }}
                                aria-current={session.id === props.selectedId ? 'true' : undefined}
                                className="social-pressable flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left aria-[current=true]:bg-[var(--social-muted)]"
                            >
                                <SessionAvatar session={session} size={28} muted={!session.active} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-body text-[var(--social-fg)]">{getSessionTitle(session, { fallbackIdLength: 12 })}</span>
                                    <span className="block truncate text-caption text-[var(--social-fg-muted)]">
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
    const requirementId = useId()
    const criteriaId = useId()
    const maxRoundsId = useId()

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
                    <FormField label={t('loops.create.requirement')} htmlFor={requirementId}>
                        <textarea
                            id={requirementId}
                            value={requirement}
                            onChange={(event) => setRequirement(event.target.value)}
                            placeholder={t('loops.create.requirementPlaceholder')}
                            rows={3}
                            className={cn(DIALOG_INPUT_CLASS, 'resize-none')}
                        />
                    </FormField>
                    <FormField label={t('loops.create.criteria')} htmlFor={criteriaId}>
                        <textarea
                            id={criteriaId}
                            value={acceptanceCriteria}
                            onChange={(event) => setAcceptanceCriteria(event.target.value)}
                            placeholder={t('loops.create.criteriaPlaceholder')}
                            rows={3}
                            className={cn(DIALOG_INPUT_CLASS, 'resize-none')}
                        />
                    </FormField>
                </div>

                <SheetSection>
                    <div className="flex min-h-[48px] items-center gap-3 px-4 py-2">
                        <label htmlFor={maxRoundsId} className="flex-1 text-body text-[var(--social-fg)]">{t('loops.create.maxRounds')}</label>
                        <TextField
                            id={maxRoundsId}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={100}
                            value={maxRounds}
                            onChange={(event) => setMaxRounds(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
                            wrapperClassName="w-24"
                            className="px-0 text-center tabular-nums"
                        />
                    </div>
                </SheetSection>

                <SheetSection title={t('loops.create.notify')}>
                    <SegmentedControl
                        framed={false}
                        label={t('loops.create.notify')}
                        value={userPreference}
                        options={PREFERENCES.map((preference) => ({ value: preference, label: t(`loops.create.notify.${preference}`) }))}
                        onChange={setUserPreference}
                    />
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
