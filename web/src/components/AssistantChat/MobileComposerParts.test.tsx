import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { I18nProvider } from '@/lib/i18n-context'
import { DictationBar, DictationButton, MobileComposerAction, VoiceCallBar } from './MobileComposerParts'

type ActionProps = ComponentProps<typeof MobileComposerAction>

function renderAction(overrides: Partial<ActionProps> = {}) {
    const props: ActionProps = {
        hasDraft: false,
        canSend: false,
        isSending: false,
        showStop: false,
        abortDisabled: false,
        isAborting: false,
        voiceEnabled: true,
        voiceStatus: 'disconnected',
        controlsDisabled: false,
        onSend: vi.fn(),
        onAbort: vi.fn(),
        onVoiceToggle: vi.fn(),
        ...overrides
    }
    render(<I18nProvider><MobileComposerAction {...props} /></I18nProvider>)
    return props
}

afterEach(cleanup)

describe('MobileComposerAction', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'localStorage', {
            value: { getItem: vi.fn(() => 'en'), setItem: vi.fn(), removeItem: vi.fn() },
            configurable: true
        })
    })

    it('is the voice button while the input is empty', () => {
        const props = renderAction()
        fireEvent.click(screen.getByRole('button', { name: 'Voice' }))
        expect(props.onVoiceToggle).toHaveBeenCalledOnce()
        expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    })

    it('turns into send once there is a draft', () => {
        const props = renderAction({ hasDraft: true, canSend: true })
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))
        expect(props.onSend).toHaveBeenCalledOnce()
        expect(screen.queryByRole('button', { name: 'Voice' })).toBeNull()
    })

    it('stops a running agent before offering voice', () => {
        renderAction({ showStop: true })
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    })

    it('is the dictation mic on an empty draft and send once there is text', () => {
        const dictation = { status: 'idle' as const, onStart: vi.fn(), onFinish: vi.fn() }
        renderAction({ dictation })
        fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
        expect(dictation.onStart).toHaveBeenCalledOnce()
        expect(screen.queryByRole('button', { name: 'Voice' })).toBeNull()
        cleanup()
        renderAction({ dictation, hasDraft: true, canSend: true })
        expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
    })

    it('ends an active voice chat when the input is empty', () => {
        renderAction({ voiceStatus: 'connected' })
        expect(screen.getByRole('button', { name: 'End voice' })).toBeInTheDocument()
    })
})

describe('VoiceCallBar', () => {
    it('keeps mute and hang-up reachable during a call', () => {
        const onToggleMic = vi.fn()
        const onEnd = vi.fn()
        render(<I18nProvider><VoiceCallBar status="connected" micMuted onToggleMic={onToggleMic} onEnd={onEnd} /></I18nProvider>)
        expect(screen.getByText('Voice chat on · mic muted')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))
        fireEvent.click(screen.getByRole('button', { name: 'End' }))
        expect(onToggleMic).toHaveBeenCalledOnce()
        expect(onEnd).toHaveBeenCalledOnce()
    })
})

describe('Dictation controls', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'localStorage', {
            value: { getItem: vi.fn(() => 'en'), setItem: vi.fn(), removeItem: vi.fn() },
            configurable: true
        })
    })

    it('starts from the mic and finishes from the same button while recording', () => {
        const onStart = vi.fn()
        const onFinish = vi.fn()
        const { rerender } = render(<I18nProvider><DictationButton status="idle" disabled={false} onStart={onStart} onFinish={onFinish} /></I18nProvider>)
        fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
        expect(onStart).toHaveBeenCalledTimes(1)
        rerender(<I18nProvider><DictationButton status="recording" disabled={false} onStart={onStart} onFinish={onFinish} /></I18nProvider>)
        fireEvent.click(screen.getByRole('button', { name: 'Finish dictation' }))
        expect(onFinish).toHaveBeenCalledTimes(1)
        rerender(<I18nProvider><DictationButton status="transcribing" disabled={false} onStart={onStart} onFinish={onFinish} /></I18nProvider>)
        expect(screen.getByRole('button', { name: 'Dictate' })).toBeDisabled()
    })

    it('shows the recording time with cancel and done', () => {
        const props = { status: 'recording' as const, elapsedMs: 65_400, error: null, onCancel: vi.fn(), onFinish: vi.fn(), onDismissError: vi.fn() }
        render(<I18nProvider><DictationBar {...props} /></I18nProvider>)
        expect(screen.getByRole('status').textContent).toContain('Listening 1:05')
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
        expect(props.onCancel).toHaveBeenCalledTimes(1)
        expect(props.onFinish).toHaveBeenCalledTimes(1)
    })

    it('shows why dictation failed and hides when idle', () => {
        const props = { status: 'idle' as const, elapsedMs: 0, onCancel: vi.fn(), onFinish: vi.fn(), onDismissError: vi.fn() }
        const { container, rerender } = render(<I18nProvider><DictationBar {...props} error={null} /></I18nProvider>)
        expect(container.textContent).toBe('')
        rerender(<I18nProvider><DictationBar {...props} error="micPermission" /></I18nProvider>)
        expect(screen.getByRole('alert').textContent).toContain('No microphone access')
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(props.onDismissError).toHaveBeenCalledTimes(1)
    })
})
