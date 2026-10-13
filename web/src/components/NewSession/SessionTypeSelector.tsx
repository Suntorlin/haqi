import type { RefObject } from 'react'
import type { SessionType } from './types'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { FieldHint, FormField, SegmentedControl } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'

export function SessionTypeSelector(props: {
    sessionType: SessionType
    worktreeName: string
    worktreeInputRef: RefObject<HTMLInputElement | null>
    isDisabled: boolean
    onSessionTypeChange: (value: SessionType) => void
    onWorktreeNameChange: (value: string) => void
}) {
    const { t } = useTranslation()
    const isWorktree = props.sessionType === 'worktree'

    return (
        <FormField label={t('newSession.type')}>
            <SegmentedControl
                label={t('newSession.type')}
                value={props.sessionType}
                options={[
                    { value: 'simple', label: t('newSession.type.simple') },
                    { value: 'worktree', label: t('newSession.type.worktree') }
                ]}
                disabled={props.isDisabled}
                onChange={props.onSessionTypeChange}
            />
            <FieldHint>{isWorktree ? t('newSession.type.worktree.desc') : t('newSession.type.simple.desc')}</FieldHint>
            {isWorktree ? (
                <input
                    ref={props.worktreeInputRef}
                    type="text"
                    aria-label={t('newSession.type.worktree')}
                    placeholder={t('newSession.type.worktree.placeholder')}
                    value={props.worktreeName}
                    onChange={(e) => props.onWorktreeNameChange(e.target.value)}
                    disabled={props.isDisabled}
                    className={`${DIALOG_INPUT_CLASS} disabled:opacity-50`}
                />
            ) : null}
        </FormField>
    )
}
