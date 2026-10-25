import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionTagManagerDialog } from './SessionTagManagerDialog'

function dialog(hiddenTags: string[], onHiddenTagsChange = vi.fn()) {
    return (
        <I18nProvider>
            <SessionTagManagerDialog
                isOpen
                onClose={vi.fn()}
                tags={[{ tag: 'prod', count: 3 }, { tag: 'sa', count: 1 }]}
                hiddenTags={hiddenTags}
                onHiddenTagsChange={onHiddenTagsChange}
            />
        </I18nProvider>
    )
}

describe('SessionTagManagerDialog', () => {
    it('hides a shown tag and shows a hidden one', () => {
        const onHiddenTagsChange = vi.fn()
        render(dialog(['sa'], onHiddenTagsChange))
        const [prod, sa] = screen.getAllByRole('switch')
        expect(prod.getAttribute('aria-checked')).toBe('true')
        expect(sa.getAttribute('aria-checked')).toBe('false')

        fireEvent.click(prod)
        expect(onHiddenTagsChange).toHaveBeenLastCalledWith(['sa', 'prod'])
        fireEvent.click(sa)
        expect(onHiddenTagsChange).toHaveBeenLastCalledWith([])
    })
})
