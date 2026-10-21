import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CheckRow } from './CheckRow'

describe('CheckRow', () => {
    it('ticks with the checkbox and edits with the text', () => {
        const onCheckedChange = vi.fn()
        const onEdit = vi.fn()
        render(
            <CheckRow
                checked
                onCheckedChange={onCheckedChange}
                label="Tests pass"
                title="Tests pass"
                onEdit={onEdit}
                editLabel="Edit"
            />
        )

        const checkbox = screen.getByRole('checkbox', { name: 'Tests pass' })
        expect(checkbox.getAttribute('aria-checked')).toBe('true')
        fireEvent.click(checkbox)
        expect(onCheckedChange).toHaveBeenCalledWith(false)
        expect(onEdit).not.toHaveBeenCalled()

        fireEvent.click(screen.getByTitle('Edit'))
        expect(onEdit).toHaveBeenCalledTimes(1)
    })

    it('keeps an unticked row visible, struck through', () => {
        render(<CheckRow checked={false} onCheckedChange={() => {}} label="Done" title="Done" />)
        expect(screen.getByRole('checkbox', { name: 'Done' }).getAttribute('aria-checked')).toBe('false')
        expect(screen.getByText('Done').className).toContain('line-through')
    })
})
