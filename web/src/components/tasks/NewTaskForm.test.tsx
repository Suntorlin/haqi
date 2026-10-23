import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import { NewTaskForm } from './NewTaskForm'

function renderForm(onCreate = vi.fn(async () => {})) {
    render(
        <QueryClientProvider client={new QueryClient()}>
            <I18nProvider>
                <NewTaskForm onCreate={onCreate} />
            </I18nProvider>
        </QueryClientProvider>
    )
    return onCreate
}

describe('NewTaskForm', () => {
    afterEach(cleanup)

    it('sends picked files with the task, in base64', async () => {
        const onCreate = renderForm()
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '照文档改' } })
        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        fireEvent.change(input, { target: { files: [new File(['hello'], 'spec.txt', { type: 'text/plain' })] } })
        await waitFor(() => expect((screen.getByRole('button', { name: /^(Send|发送)$/ }) as HTMLButtonElement).disabled).toBe(false))
        fireEvent.submit(input.closest('form')!)
        await waitFor(() => expect(onCreate).toHaveBeenCalled())
        expect(onCreate).toHaveBeenCalledWith({
            text: '照文档改',
            draft: true,
            files: [{ filename: 'spec.txt', mimeType: 'text/plain', content: btoa('hello') }]
        })
    })

    it('leaves files out when none are picked, and drops a removed one', async () => {
        const onCreate = renderForm()
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '修 bug' } })
        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } })
        await screen.findByText('a.txt')
        fireEvent.click(screen.getAllByRole('button').find((button) => button.getAttribute('aria-label')?.match(/remove|移除/i))!)
        fireEvent.submit(input.closest('form')!)
        await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ text: '修 bug', draft: true }))
    })
})
