import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { Session } from '@/types/api'
import { useArchiveSession } from './useArchiveSession'

function sessionWithTags(tags: string[]): { session: Session } {
    return {
        session: {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: false,
            activeAt: 1,
            metadata: { path: '/repo', host: 'mac', tags },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0
        } as Session
    }
}

function setup(tags: string[], archiveError?: Error) {
    const api = {
        archiveSession: archiveError ? vi.fn().mockRejectedValue(archiveError) : vi.fn().mockResolvedValue(undefined),
        getSession: vi.fn().mockResolvedValue(sessionWithTags(tags)),
        updateSessionTags: vi.fn().mockResolvedValue([])
    }
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useArchiveSession(api as unknown as ApiClient), { wrapper })
    return { api, archive: result.current }
}

describe('useArchiveSession', () => {
    it('unpins a pinned session after archiving it, keeping its other tags', async () => {
        const { api, archive } = setup(['infra', 'pinned'])
        await archive('session-1')
        expect(api.archiveSession).toHaveBeenCalledWith('session-1')
        expect(api.updateSessionTags).toHaveBeenCalledWith('session-1', ['infra'])
    })

    it('leaves the tags of an unpinned session alone', async () => {
        const { api, archive } = setup(['infra'])
        await archive('session-1')
        expect(api.updateSessionTags).not.toHaveBeenCalled()
    })

    it('keeps the pin when the archive fails', async () => {
        const { api, archive } = setup(['pinned'], new Error('HTTP 409'))
        await expect(archive('session-1')).rejects.toThrow('HTTP 409')
        expect(api.updateSessionTags).not.toHaveBeenCalled()
    })
})
