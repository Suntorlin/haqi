import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidBlock, isMermaidLanguage } from '@/components/assistant-ui/mermaid-block'
import { setThemePreference } from '@/hooks/useTheme'
import { I18nProvider } from '@/lib/i18n-context'

const initialize = vi.fn()
const renderDiagram = vi.fn()

vi.mock('mermaid', () => ({
    default: {
        initialize,
        render: renderDiagram,
    }
}))

describe('isMermaidLanguage', () => {
    it('accepts mermaid code fence aliases', () => {
        expect(isMermaidLanguage('mermaid')).toBe(true)
        expect(isMermaidLanguage('Mermaid')).toBe(true)
        expect(isMermaidLanguage(' mmd ')).toBe(true)
        expect(isMermaidLanguage('ts')).toBe(false)
        expect(isMermaidLanguage(undefined)).toBe(false)
    })
})

describe('MermaidBlock', () => {
    beforeEach(() => {
        initialize.mockReset()
        renderDiagram.mockReset()
        setThemePreference('light')
        localStorage.setItem('hapi-lang', 'en')
    })

    afterEach(() => {
        cleanup()
        setThemePreference('system')
    })

    it('renders Mermaid SVG output for mermaid code blocks', async () => {
        const bindFunctions = vi.fn()
        renderDiagram.mockResolvedValue({
            svg: '<svg><text>diagram</text></svg>',
            bindFunctions,
        })

        const { container } = render(
            <MermaidBlock code={'flowchart TD\nA-->B'} language="mermaid" />,
            { wrapper: I18nProvider }
        )

        expect(screen.getByText('Rendering Mermaid…')).toBeInTheDocument()

        await waitFor(() => {
            expect(container.querySelector('.aui-md-mermaid-svg svg')).toBeInTheDocument()
        })

        expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
            startOnLoad: false,
            securityLevel: 'antiscript',
            theme: 'neutral',
            darkMode: false,
        }))
        expect(bindFunctions).toHaveBeenCalledTimes(1)
    })

    it('shows fallback source when rendering fails', async () => {
        renderDiagram.mockRejectedValue(new Error('Parse error'))

        render(<MermaidBlock code={'flowchart TD\nA-->B'} language="mermaid" />, { wrapper: I18nProvider })

        await waitFor(() => {
            expect(screen.getByText('Mermaid render failed')).toBeInTheDocument()
        })

        expect(screen.getByText('Parse error')).toBeInTheDocument()
        expect(screen.getAllByText((_, node) => node?.textContent === 'flowchart TD\nA-->B').length).toBeGreaterThan(0)
    })
})
