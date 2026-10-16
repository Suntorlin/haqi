import { describe, expect, it } from 'vitest'
import { computeTurnLayout } from './SocialMessages'

function toolPart(options: { result?: unknown; pendingPermission?: boolean } = {}) {
    return {
        type: 'tool-call',
        result: options.result,
        artifact: {
            kind: 'tool-call',
            tool: {
                name: 'Bash',
                input: {},
                ...(options.pendingPermission ? { permission: { status: 'pending' } } : {})
            },
            children: []
        }
    }
}

describe('computeTurnLayout', () => {
    it('lists every step so far for a running turn, the reply being written included', () => {
        const parts = [
            { type: 'reasoning', text: 'planning' },
            { type: 'text', text: 'Let me check the logs.' },
            toolPart({ result: 'ok' }),
            { type: 'text', text: '   ' },
            toolPart(),
            { type: 'text', text: 'Found it: the token expired.' }
        ]

        const layout = computeTurnLayout(parts)

        expect(layout.liveIndices).toEqual([0, 1, 2, 4, 5])
        // A finished turn shows the reply on its own and keeps it out of the process.
        expect(layout.answerIndices).toEqual([5])
        expect(layout.processIndices).toEqual([0, 1, 2, 4])
        expect(layout.steps).toBe(2)
    })

    it('shows an answer written mid-turn next to the final reply, and folds only short status lines', () => {
        const parts = [
            { type: 'reasoning', text: 'planning' },
            { type: 'text', text: 'Still in use.\n\nEvery new signup domain is checked once; 1,899 lookups in the last 7 days.' },
            toolPart({ result: 'ok' }),
            { type: 'text', text: 'The suite stopped at 4% with no failures. Restarting it detached.' },
            toolPart({ result: 'ok' }),
            { type: 'text', text: 'Tests are running again in the background.' }
        ]

        const layout = computeTurnLayout(parts)

        expect(layout.answerIndices).toEqual([1, 5])
        expect(layout.processIndices).toEqual([0, 2, 3, 4])
    })

    it('keeps a step waiting for approval out of the list, since it is always shown below', () => {
        const parts = [
            toolPart({ result: 'ok' }),
            toolPart({ pendingPermission: true })
        ]

        const layout = computeTurnLayout(parts)

        expect(layout.pendingIndices).toEqual([1])
        expect(layout.liveIndices).toEqual([0])
    })
})
