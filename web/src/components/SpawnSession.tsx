import { useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { Button } from '@/components/ui/button'
import { FieldHint, FormField, SegmentedControl } from '@/components/ui/FormControls'
import { TextField } from '@/components/ui/TextField'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePlatform } from '@/hooks/usePlatform'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { formatRunnerSpawnError } from '@/utils/formatRunnerSpawnError'
import { useTranslation } from '@/lib/use-translation'

type SessionType = 'simple' | 'worktree'

function getMachineTitle(machine: Machine | null): string {
    if (!machine) return 'Machine'
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

export function SpawnSession(props: {
    api: ApiClient
    machineId: string
    machine: Machine | null
    onSuccess: (sessionId: string) => void
    onCancel: () => void
}) {
    const { haptic } = usePlatform()
    const [directory, setDirectory] = useState('')
    const [sessionType, setSessionType] = useState<SessionType>('simple')
    const [worktreeName, setWorktreeName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const { spawnSession, isPending, error: spawnError } = useSpawnSession(props.api)

    const machineTitle = useMemo(() => getMachineTitle(props.machine), [props.machine])
    const runnerSpawnError = useMemo(
        () => formatRunnerSpawnError(props.machine),
        [props.machine?.runnerState?.lastSpawnError]
    )

    async function spawn() {
        const trimmed = directory.trim()
        if (!trimmed) return

        setError(null)
        try {
            const result = await spawnSession({
                machineId: props.machineId,
                directory: trimmed,
                sessionType,
                worktreeName: sessionType === 'worktree' ? (worktreeName.trim() || undefined) : undefined
            })
            if (result.type === 'success') {
                haptic.notification('success')
                props.onSuccess(result.sessionId)
                return
            }
            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            haptic.notification('error')
            setError(e instanceof Error ? e.message : 'Failed to spawn session')
        }
    }

    const displayError = error ?? spawnError

    return (
        <div className="p-3">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle>Create Session</CardTitle>
                    <CardDescription className="truncate">
                        {machineTitle}
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className="flex flex-col gap-4">
                        <TextField
                            type="text"
                            aria-label="Directory"
                            placeholder="/path/to/project"
                            value={directory}
                            onChange={(e) => setDirectory(e.target.value)}
                        />

                        <FormField label="Session type">
                            <SegmentedControl
                                label="Session type"
                                value={sessionType}
                                options={[
                                    { value: 'simple', label: 'Simple' },
                                    { value: 'worktree', label: 'Worktree' }
                                ]}
                                disabled={isPending}
                                onChange={setSessionType}
                            />
                            <FieldHint>
                                {sessionType === 'worktree'
                                    ? 'Create a new worktree next to the repo'
                                    : 'Use the selected directory as-is'}
                            </FieldHint>
                            {sessionType === 'worktree' ? (
                                <TextField
                                    type="text"
                                    aria-label="Worktree name"
                                    placeholder="feature-x (default 1228-xxxx)"
                                    value={worktreeName}
                                    onChange={(e) => setWorktreeName(e.target.value)}
                                    disabled={isPending}
                                />
                            ) : null}
                        </FormField>

                        {runnerSpawnError ? (
                            <div className="text-[12px] text-[var(--social-danger)]">
                                Runner last spawn error: {runnerSpawnError}
                            </div>
                        ) : null}

                        {displayError ? (
                            <div className="text-[13px] text-[var(--social-danger)]">
                                {displayError}
                            </div>
                        ) : null}

                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={props.onCancel}
                                disabled={isPending}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={spawn}
                                disabled={isPending || !directory.trim()}
                            >
                                {isPending ? 'Creating…' : 'Create Session'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
