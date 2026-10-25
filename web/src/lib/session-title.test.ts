import { describe, expect, it } from 'vitest'
import { getSessionLabelCandidates } from './session-title'

describe('getSessionLabelCandidates', () => {
    it('goes from the full title to the short title', () => {
        const session = {
            id: 's1',
            metadata: { path: '/Users/me/dev/fish', summary: { text: '规划 · Implement this design from Figma', short: 'Figma 设计' } }
        }
        expect(getSessionLabelCandidates(session as never)).toEqual([
            '规划 · Implement this design from Figma',
            'Implement this design from Figma',
            'Figma 设计'
        ])
    })

    it('ignores the short title once the user renamed the session', () => {
        const session = {
            id: 's1',
            metadata: { path: '/Users/me/dev/fish', name: 'My name', summary: { text: 'Agent title', short: 'Agent' } }
        }
        expect(getSessionLabelCandidates(session as never)).toEqual(['My name'])
    })
})
