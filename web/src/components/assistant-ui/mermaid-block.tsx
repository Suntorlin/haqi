import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

const MERMAID_LANGUAGES = new Set(['mermaid', 'mmd'])

type MermaidModule = typeof import('mermaid')

type MermaidRenderState = {
    svg: string | null
    error: string | null
    bindFunctions?: ((element: Element) => void) | undefined
}

function normalizeLanguage(language?: string): string {
    return language?.trim().toLowerCase() ?? ''
}

export function isMermaidLanguage(language?: string): boolean {
    return MERMAID_LANGUAGES.has(normalizeLanguage(language))
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message
    }

    if (typeof error === 'string' && error.trim()) {
        return error
    }

    return 'Failed to render Mermaid diagram.'
}

async function renderDiagram(module: MermaidModule, params: {
    code: string
    id: string
    isDark: boolean
}) {
    const mermaid = module.default

    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'antiscript',
        theme: params.isDark ? 'dark' : 'neutral',
        darkMode: params.isDark,
    })

    return mermaid.render(params.id, params.code)
}

export function MermaidBlock(props: {
    code: string
    language?: string
    className?: string
}) {
    const { isDark } = useTheme()
    const reactId = useId()
    const containerRef = useRef<HTMLDivElement | null>(null)
    const renderKey = useMemo(() => reactId.replace(/[:]/g, '-'), [reactId])
    const [state, setState] = useState<MermaidRenderState>({
        svg: null,
        error: null,
    })

    useEffect(() => {
        let cancelled = false

        setState({ svg: null, error: null })

        void import('mermaid')
            .then((module) => renderDiagram(module, {
                code: props.code,
                id: `mermaid-${renderKey}`,
                isDark,
            }))
            .then((result) => {
                if (cancelled) return
                setState({
                    svg: result.svg,
                    error: null,
                    bindFunctions: result.bindFunctions,
                })
            })
            .catch((error: unknown) => {
                if (cancelled) return
                setState({
                    svg: null,
                    error: getErrorMessage(error),
                })
            })

        return () => {
            cancelled = true
        }
    }, [props.code, renderKey, isDark])

    useEffect(() => {
        if (!state.svg || !containerRef.current || !state.bindFunctions) {
            return
        }

        state.bindFunctions(containerRef.current)
    }, [state.svg, state.bindFunctions])

    if (state.error) {
        return (
            <div className={cn('aui-md-mermaid-error rounded-b-md border border-[var(--social-border)] bg-[var(--app-code-bg)] p-3 text-footnote', props.className)}>
                <div className="font-semibold text-[var(--social-danger)]">Mermaid render failed</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-[var(--social-fg-muted)]">{state.error}</div>
                <pre className="mt-3 overflow-x-auto rounded-md bg-[var(--social-hover)] p-2 text-xs font-mono text-[var(--social-fg)]">
                    <code>{props.code}</code>
                </pre>
            </div>
        )
    }

    return (
        <div className={cn('aui-md-mermaid min-w-0 w-full max-w-full overflow-x-auto rounded-b-md bg-[var(--app-code-bg)] p-3', props.className)}>
            {state.svg
                ? <div ref={containerRef} className="aui-md-mermaid-svg min-w-max" dangerouslySetInnerHTML={{ __html: state.svg }} />
                : <div className="text-footnote text-[var(--social-fg-muted)]">Rendering Mermaid…</div>}
        </div>
    )
}
