import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionTagsDialog } from './SessionTagsDialog'

function dialog(tags: string[], onSave = vi.fn(async () => {})) {
    return (
        <I18nProvider>
            <SessionTagsDialog isOpen onClose={vi.fn()} tags={tags} onSave={onSave} isPending={false} />
        </I18nProvider>
    )
}

describe('SessionTagsDialog', () => {
    it('keeps what the user typed when the parent re-renders with a fresh tags array', () => {
        const { rerender } = render(dialog(['a']))
        const input = screen.getByRole('textbox') as HTMLInputElement
        fireEvent.change(input, { target: { value: 'a, brand-new' } })

        rerender(dialog(['a']))

        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('a, brand-new')
    })
})
