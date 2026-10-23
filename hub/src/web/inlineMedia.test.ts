import { describe, expect, it } from 'bun:test'
import { omitInlineMedia } from './inlineMedia'

const bigData = 'A'.repeat(4000)

describe('omitInlineMedia', () => {
    it('drops the bytes of a base64 image inside a tool result', () => {
        const content = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    message: {
                        content: [{
                            type: 'tool_result',
                            content: [
                                { type: 'text', text: 'shot saved' },
                                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bigData } }
                            ]
                        }]
                    }
                }
            }
        }

        const result = omitInlineMedia(content)
        const block = result.content.data.message.content[0]!.content[1] as { source: Record<string, unknown> }
        expect(block.source).toEqual({ type: 'base64', media_type: 'image/png', data: '', omittedBytes: 3000 })
        expect(result.content.data.message.content[0]!.content[0]).toEqual({ type: 'text', text: 'shot saved' })
    })

    it('leaves the input untouched', () => {
        const source = { type: 'base64', media_type: 'image/png', data: bigData }
        const content = { blocks: [{ type: 'image', source }] }
        omitInlineMedia(content)
        expect(source.data).toBe(bigData)
        expect(content.blocks[0]!.source).toBe(source)
    })

    it('returns the same object when nothing is big', () => {
        const content = { blocks: [{ type: 'image', source: { type: 'base64', data: 'iVBOR' } }, { type: 'text', text: bigData }] }
        expect(omitInlineMedia(content)).toBe(content)
    })
})
