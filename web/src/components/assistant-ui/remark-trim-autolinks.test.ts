import { describe, expect, it } from 'vitest'
import { trimAutolinkUrl } from './remark-trim-autolinks'

describe('trimAutolinkUrl', () => {
    it('cuts at full-width punctuation', () => {
        expect(trimAutolinkUrl('https://haqi.suntorai.com/share/r/abc（链接已验证返回')).toBe('https://haqi.suntorai.com/share/r/abc')
    })

    it('cuts at CJK text without punctuation', () => {
        expect(trimAutolinkUrl('https://a.com/x说明')).toBe('https://a.com/x')
    })

    it('keeps plain urls untouched', () => {
        expect(trimAutolinkUrl('https://a.com/x?y=1&z=%E4%B8%AD')).toBe('https://a.com/x?y=1&z=%E4%B8%AD')
    })
})
