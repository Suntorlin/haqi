import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { I18nProvider } from '@/lib/i18n-context'
import { MobileComposerAction, VoiceCallBar } from './MobileComposerParts'

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
