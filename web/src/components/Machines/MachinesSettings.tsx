import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine, MachineRole } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { getMachineTitle } from '@/components/NewSession/MachineSelector'
import { SettingsCard, SettingsNotice } from '@/components/settings/SettingsParts'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormField, SegmentedControl } from '@/components/ui/FormControls'
import { TextField } from '@/components/ui/TextField'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'

function formatEnv(env: Record<string, string> | undefined): string {
    return Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n')
}

/** KEY=VALUE per line; blank lines and # comments are skipped. Returns the bad line on error. */
export function parseEnv(text: string): { env: Record<string, string> } | { badLine: string } {
    const env: Record<string, string> = {}
    for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        const key = eq > 0 ? line.slice(0, eq).trim() : ''
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return { badLine: line }
        env[key] = line.slice(eq + 1).trim()
    }
    return { env }
}

function MachineCard({ api, machine, onSaved }: { api: ApiClient; machine: Machine; onSaved: () => void }) {
    const { t } = useTranslation()
    const initialName = machine.metadata?.displayName ?? ''
    const initialRole: MachineRole = machine.metadata?.role ?? 'always-on'
    const initialEnv = formatEnv(machine.metadata?.env)
    const [name, setName] = useState(initialName)
    const [role, setRole] = useState<MachineRole>(initialRole)
    const [envText, setEnvText] = useState(initialEnv)
    const [saving, setSaving] = useState(false)
    const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
    const dirty = name !== initialName || role !== initialRole || envText !== initialEnv

    const save = async () => {
        const parsed = parseEnv(envText)
        if ('badLine' in parsed) {
            setNotice({ tone: 'error', text: t('settings.machines.envBadLine', { line: parsed.badLine }) })
            return
        }
        setSaving(true)
        setNotice(null)
        try {
            await api.updateMachine(machine.id, { displayName: name.trim() || null, role, env: parsed.env })
            setNotice({ tone: 'success', text: t('settings.machines.saved') })
            onSaved()
        } catch (error) {
            setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
            setSaving(false)
        }
    }

    const details = [machine.metadata?.host, machine.metadata?.happyCliVersion && `v${machine.metadata.happyCliVersion}`].filter(Boolean).join(' · ')
    return (
        <SettingsCard
            title={getMachineTitle(machine)}
            trailing={machine.active ? t('settings.machines.online') : t('settings.machines.offline')}
        >
            {details ? <p className="text-footnote text-[var(--social-fg-muted)]">{details}</p> : null}
            <FormField label={t('settings.machines.name')} htmlFor={`machine-name-${machine.id}`} optional>
                <TextField
                    id={`machine-name-${machine.id}`}
                    value={name}
                    maxLength={80}
                    placeholder={machine.metadata?.host ?? ''}
                    onChange={(event) => setName(event.target.value)}
                />
            </FormField>
            <FormField label={t('settings.machines.role')} hint={t(role === 'portable' ? 'settings.machines.role.portableHint' : 'settings.machines.role.alwaysOnHint')}>
                <SegmentedControl<MachineRole>
                    label={t('settings.machines.role')}
                    value={role}
                    options={[
                        { value: 'always-on', label: t('settings.machines.role.alwaysOn') },
                        { value: 'portable', label: t('settings.machines.role.portable') }
                    ]}
                    onChange={setRole}
                />
            </FormField>
            <FormField label={t('settings.machines.env')} htmlFor={`machine-env-${machine.id}`} optional hint={t('settings.machines.envHint')}>
                <AutoTextarea
                    id={`machine-env-${machine.id}`}
                    className={`${DIALOG_INPUT_CLASS} font-mono text-footnote`}
                    minRows={2}
                    maxRows={10}
                    spellCheck={false}
                    placeholder="TEST_DB_URL=mongodb://localhost:27017"
                    value={envText}
                    onChange={(event) => setEnvText(event.target.value)}
                />
            </FormField>
            {notice ? <SettingsNotice tone={notice.tone}>{notice.text}</SettingsNotice> : null}
            <div className="flex gap-2">
                <Button disabled={!dirty || saving} onClick={() => void save()}>
                    {saving ? t('settings.machines.saving') : t('settings.machines.save')}
                </Button>
                {dirty ? (
                    <Button variant="secondary" disabled={saving} onClick={() => { setName(initialName); setRole(initialRole); setEnvText(initialEnv); setNotice(null) }}>
                        {t('settings.machines.discard')}
                    </Button>
                ) : null}
            </div>
        </SettingsCard>
    )
}

/** Every machine that ever connected: its name, whether it is always on, and env for the sessions it starts. */
export function MachinesSettings({ api }: { api: ApiClient }) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: queryKeys.machinesAll,
        queryFn: async () => await api.getMachines({ includeOffline: true })
    })
    const machines = query.data?.machines ?? []
    if (query.isLoading) return null
    if (query.isError) return <SettingsNotice tone="error">{query.error.message}</SettingsNotice>
    if (machines.length === 0) return <EmptyState role="status" title={t('settings.machines.empty')} />

    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.machinesAll })
        void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
    }
    return (
        <div className="flex flex-col gap-3">
            {machines.map((machine) => (
                <MachineCard
                    key={`${machine.id}:${machine.metadata?.displayName ?? ''}:${machine.metadata?.role ?? ''}:${formatEnv(machine.metadata?.env)}`}
                    api={api}
                    machine={machine}
                    onSaved={refresh}
                />
            ))}
        </div>
    )
}
