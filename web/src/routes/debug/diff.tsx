import { Suspense, lazy, useMemo } from 'react'
import { useTheme } from '@/hooks/useTheme'

const GitDiffViewer = lazy(() => import('@/components/GitDiffViewer'))

const OLD_TS = `import { useMemo } from 'react'

type User = {
    id: string
    name: string
}

export function formatUser(user: User): string {
    const label = user.name.trim()
    return 'Hello, ' + label
}
`

const NEW_TS = `import { useMemo } from 'react'

type User = {
    id: string
    name: string
    email?: string
}

export function formatUser(user: User): string {
    const label = user.name.trim()
    return \`Hello, \${label}!\`
}
`

const DIFF_TS = [
    'diff --git a/src/debug-demo.ts b/src/debug-demo.ts',
    'index 1111111..2222222 100644',
    '--- a/src/debug-demo.ts',
    '+++ b/src/debug-demo.ts',
    '@@ -1,10 +1,11 @@',
    " import { useMemo } from 'react'",
    ' ',
    ' type User = {',
    '     id: string',
    '     name: string',
    '-}',
    '+    email?: string',
    '+}',
    ' ',
    ' export function formatUser(user: User): string {',
    '     const label = user.name.trim()',
    "-    return 'Hello, ' + label",
    '+    return `Hello, ${label}!`',
    ' }',
].join('\n')

export default function DebugDiffPage() {
    const { isDark } = useTheme()

    const subtitle = useMemo(() => {
        return 'Dummy page for verifying syntax highlighting in git-diff-view'
    }, [])

    return (
        <div className="min-h-screen bg-[var(--social-surface)] text-[var(--social-fg)]">
            <div className="mx-auto w-full max-w-6xl p-6">
                <div className="mb-4">
                    <h1 className="text-title font-semibold">Debug Diff Viewer</h1>
                    <p className="mt-1 text-footnote text-[var(--social-fg-muted)]">{subtitle}</p>
                </div>

                <Suspense fallback={<div className="rounded-md border border-[var(--social-border)] p-4 text-footnote text-[var(--social-fg-muted)]">Loading diff viewer…</div>}>
                    <GitDiffViewer
                        filePath="src/debug-demo.ts"
                        language="typescript"
                        oldContent={OLD_TS}
                        newContent={NEW_TS}
                        diffContent={DIFF_TS}
                        theme={isDark ? 'dark' : 'light'}
                    />
                </Suspense>
            </div>
        </div>
    )
}
