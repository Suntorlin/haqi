import { describe, expect, it } from 'bun:test'
import { choiceOf, matchPrecedent } from './precedent'

describe('precedent', () => {
    it('reads the choice out of a decision experience', () => {
        expect(choiceOf('情境：截图放哪里；选项：Linear/Obsidian；你选了：Linear')).toBe('Linear')
        expect(choiceOf('报告结论先行')).toBeNull()
    })

    it('answers only with a close match whose choice is one of the options', () => {
        const hit = (text: string, score: number) => ({ memoryId: 'm1', text, score })
        expect(matchPrecedent(['Linear', 'Obsidian'], [hit('情境：截图放哪里；选项：Linear/Obsidian；你选了：Obsidian', 0.9)])).toEqual({ label: 'Obsidian', memoryId: 'm1' })
        expect(matchPrecedent(['Linear', 'Obsidian'], [hit('情境：截图放哪里；选项：Linear/Obsidian；你选了：Obsidian', 0.7)])).toBeNull()
        expect(matchPrecedent(['A', 'B'], [hit('情境：x；选项：C/D；你选了：C', 0.95)])).toBeNull()
    })
})
