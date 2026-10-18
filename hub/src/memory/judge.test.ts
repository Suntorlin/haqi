import { describe, expect, it } from 'bun:test'
import { decide, parseVerdict, type JevVerdict } from './judge'
import { mostSimilar } from './similarity'

function verdict(patch: Partial<JevVerdict> = {}): JevVerdict {
    return {
        keep: 0.9,
        level: { choice: 'experience', confidence: 0.8 },
        scope: { choice: 'project', confidence: 0.9 },
        match: { id: null, confidence: 0.9 },
        secret: 0,
        ...patch
    }
}

describe('decide', () => {
    it('records a memory Jev is sure about', () => {
        expect(decide({ verdict: verdict(), said: false })).toEqual({ kind: 'add', status: 'active', reason: null, level: 'experience', scope: 'project', link: null })
    })

    it('rejects secrets and skips what is not worth keeping', () => {
        expect(decide({ verdict: verdict({ secret: 0.97 }), said: true }).kind).toBe('reject')
        expect(decide({ verdict: verdict({ keep: 0.1 }), said: true }).kind).toBe('skip')
    })

    it('puts a fact or experience Jev is unsure about on trial, and names the doubt', () => {
        const result = decide({ verdict: verdict({ scope: { choice: 'global', confidence: 0.24 } }), said: false })
        expect(result).toMatchObject({ kind: 'add', status: 'candidate', reason: 'Jev 拿不准：范围 0.24' })
    })

    it('makes principles wait for the user unless the user said them and Jev is sure', () => {
        const principle = verdict({ level: { choice: 'principle', confidence: 0.9 } })
        expect(decide({ verdict: principle, said: false })).toMatchObject({ status: 'pending', reason: '原则要你确认' })
        expect(decide({ verdict: principle, said: true })).toMatchObject({ status: 'active', reason: null })
        expect(decide({ verdict: { ...principle, keep: 0.5 }, said: true })).toMatchObject({ status: 'pending' })
        expect(decide({ verdict: { ...principle, scope: { choice: 'global', confidence: 0.3 } }, said: true })).toMatchObject({ status: 'active', scope: 'project' })
    })

    it('reinforces a sure match at the same level and links across levels', () => {
        const matched = verdict({ match: { id: 'm1', confidence: 0.95 } })
        expect(decide({ verdict: matched, said: false, matchedLevel: 'experience' })).toEqual({ kind: 'reinforce', targetId: 'm1' })
        expect(decide({ verdict: { ...matched, level: { choice: 'fact', confidence: 0.9 } }, said: false, matchedLevel: 'principle' }))
            .toMatchObject({ kind: 'add', link: { matchedId: 'm1', direction: 'supports-matched' } })
        expect(decide({ verdict: matched, said: false, matchedLevel: 'fact' }))
            .toMatchObject({ kind: 'add', link: { matchedId: 'm1', direction: 'matched-supports' } })
    })

    it('ignores a weak match', () => {
        const weak = verdict({ match: { id: 'm1', confidence: 0.5 } })
        expect(decide({ verdict: weak, said: false, matchedLevel: 'experience' })).toMatchObject({ kind: 'add', link: null })
    })
})

describe('parseVerdict', () => {
    it('reads Jev answers and defaults scope to global without a project', () => {
        const parsed = parseVerdict({
            keep: { type: 'noul', noul: { yes: 0.8, no: 0.2 } },
            level: { type: 'choice', choice: 'principle', probabilities: { principle: 0.9 }, confidence: 0.85 },
            match: { type: 'choice', choice: 'none', probabilities: { none: 1 }, confidence: 1 },
            secret: { type: 'noul', noul: 0.01 }
        }, { hasProject: false })
        expect(parsed).toEqual({
            keep: 0.8,
            level: { choice: 'principle', confidence: 0.85 },
            scope: { choice: 'global', confidence: 1 },
            match: { id: null, confidence: 1 },
            secret: 0.01
        })
    })
})

describe('mostSimilar', () => {
    it('keeps the closest few and drops unrelated ones', () => {
        const items = [{ text: '回复用中文' }, { text: '部署 web 时 index.html 最后拷' }, { text: '部署 web 前先备份 dist' }]
        expect(mostSimilar('部署 web 时 sw.js 最后拷', items, 2).map((i) => i.text)).toEqual(['部署 web 时 index.html 最后拷', '部署 web 前先备份 dist'])
    })
})
