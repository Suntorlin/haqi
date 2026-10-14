import { useMemo } from 'react'

const EXTENSION_COLORS: Record<string, string> = {
    ts: 'var(--filetype-ts)',
    tsx: 'var(--filetype-ts)',
    js: 'var(--filetype-js)',
    jsx: 'var(--filetype-js)',
    json: 'var(--filetype-json)',
    md: 'var(--filetype-md)',
    mdx: 'var(--filetype-md)',
    css: 'var(--filetype-css)',
    scss: 'var(--filetype-scss)',
    html: 'var(--filetype-html)',
    yml: 'var(--filetype-yaml)',
    yaml: 'var(--filetype-yaml)',
    sh: 'var(--filetype-sh)',
    bash: 'var(--filetype-sh)',
    py: 'var(--filetype-py)',
    go: 'var(--filetype-go)',
    rs: 'var(--filetype-rs)',
}

function getFileExtension(fileName: string): string {
    const trimmed = fileName.trim()
    if (trimmed.startsWith('.') && trimmed.indexOf('.', 1) === -1) {
        return trimmed.slice(1).toLowerCase()
    }
    const parts = trimmed.split('.')
    if (parts.length <= 1) return ''
    return parts[parts.length - 1]?.toLowerCase() ?? ''
}

export function FileIcon(props: { fileName: string; size?: number }) {
    const size = props.size ?? 20
    const color = useMemo(() => {
        const ext = getFileExtension(props.fileName)
        return EXTENSION_COLORS[ext] ?? 'var(--social-fg-muted)'
    }, [props.fileName])

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color }}
        >
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}
