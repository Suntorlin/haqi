import { describe, expect, it } from 'vitest'
import { extractReportLinks } from './reportLinks'

const URL_A = 'https://haqi.example.com/share/r/AbC_123-xyz'
const URL_B = 'https://haqi.example.com/share/r/Other-Token_9'

describe('extractReportLinks', () => {
    it('finds links in text and tool results, distinct and in order', () => {
        const links = extractReportLinks([
            { type: 'tool-call', result: { report: { publicShareUrl: URL_A } } },
            { type: 'text', text: `报告：${URL_B}\n(再贴一次 ${URL_A})` }
        ])
        expect(links).toEqual([URL_A, URL_B])
    })

    it('stops at markdown / quote delimiters and ignores other links', () => {
        expect(extractReportLinks([
            { type: 'text', text: `[查看](${URL_A}) 和 https://example.com/page` }
        ])).toEqual([URL_A])
        expect(extractReportLinks([{ type: 'text', text: 'no report here' }])).toEqual([])
    })

    it('keeps at most three', () => {
        const text = [1, 2, 3, 4].map((n) => `https://h.example/share/r/t${n}`).join(' ')
        expect(extractReportLinks([{ type: 'text', text }])).toHaveLength(3)
    })
})
