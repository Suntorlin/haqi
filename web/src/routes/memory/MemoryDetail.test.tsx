import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { AppContextProvider } from '@/lib/app-context'
import { I18nProvider } from '@/lib/i18n-context'
import type { MemoryItem } from '@/types/api'
import { MemoryDetail } from './MemoryDetail'

const memory: MemoryItem = {
    id: 'm1', text: 'Keep answers short.', level: 'principle', scope: '', status: 'pending', reason: null,
    source: 'user_message', sourceLabel: null, sessionId: null, said: true, support: 1, jev: null,
    overridden: null, replaces: null, employeeId: null, pinned: false, tags: [], version: 1, createdAt: 0, updatedAt: 0
}

function detail(props: { hotkeys: boolean; onConfirm?: () => void; onDismiss?: () => void }) {
    const api = { relatedMemories: vi.fn(async () => ({ hits: [] })) } as unknown as ApiClient
    return (
        <QueryClientProvider client={new QueryClient()}>
            <AppContextProvider value={{ api, token: '', baseUrl: '' }}>
                <I18nProvider>
                    <MemoryDetail
                        memory={memory} all={[memory]} links={[]} projects={[]} busy={false}
                        onOpen={vi.fn()} onSave={vi.fn()} onConfirm={props.onConfirm ?? vi.fn()} onDismiss={props.onDismiss ?? vi.fn()}
                        onDelete={vi.fn()} onMerge={vi.fn()} onUndoMerge={vi.fn()} hotkeys={props.hotkeys}
                    />
                </I18nProvider>
            </AppContextProvider>
        </QueryClientProvider>
    )
}

describe('MemoryDetail hotkeys', () => {
    afterEach(cleanup)

    it('approves with Enter (with the edits) and dismisses with X', () => {
        const onConfirm = vi.fn()
        const onDismiss = vi.fn()
        render(detail({ hotkeys: true, onConfirm, onDismiss }))
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep answers very short.' } })

        fireEvent.keyDown(document.body, { key: 'Enter' })
        expect(onConfirm).toHaveBeenCalledWith({ text: 'Keep answers very short.' })
        fireEvent.keyDown(document.body, { key: 'x' })
        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('leaves keys typed into the sentence alone', () => {
        const onConfirm = vi.fn()
        render(detail({ hotkeys: true, onConfirm }))
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
        expect(onConfirm).not.toHaveBeenCalled()
    })

    it('does nothing without hotkeys (the phone sheet)', () => {
        const onConfirm = vi.fn()
        render(detail({ hotkeys: false, onConfirm }))
        fireEvent.keyDown(document.body, { key: 'Enter' })
        expect(onConfirm).not.toHaveBeenCalled()
    })
})
