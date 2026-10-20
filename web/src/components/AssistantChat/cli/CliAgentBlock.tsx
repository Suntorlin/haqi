import { memo } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import type { AgentTextBlock, CliOutputBlock } from '@/chat/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { useShikiHighlighter } from '@/lib/shiki'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { isMermaidLanguage, MermaidBlock } from '@/components/assistant-ui/mermaid-block'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { IconButton } from '@/components/ui/IconButton'
import { HIT_AREA_24_CLASS } from '@/components/AssistantChat/hitArea'
import { useTranslation } from '@/lib/use-translation'

function CliCodeBlockInner(props: { language: string; code: string }) {
    const highlighted = useShikiHighlighter(props.code, props.language)
    const { copied, copy } = useCopyToClipboard()
    const { t } = useTranslation()

    return (
        <div className="my-1 min-w-0 w-full max-w-full overflow-hidden rounded-2xl border border-[var(--social-border)]">
            <div className="flex items-center justify-between bg-[var(--app-code-bg)] px-2 py-0.5">
                <span className="text-xs text-[var(--social-fg-muted)]">{props.language}</span>
                <IconButton size="sm" label={t('code.copy')} onClick={() => copy(props.code)} className={cn('h-6 w-6', HIT_AREA_24_CLASS)}>
                    {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
                </IconButton>
            </div>
            {isMermaidLanguage(props.language)
                ? <MermaidBlock code={props.code} language={props.language} />
                : (
                    <pre className="shiki m-0 w-max min-w-full overflow-x-auto bg-[var(--app-code-bg)] p-2 text-footnote font-mono">
                        <code className="block">{highlighted ?? props.code}</code>
                    </pre>
                )}
        </div>
    )
}

function CliCodeBlock(props: ComponentPropsWithoutRef<'code'>) {
    const { children, className, ...rest } = props
    const match = /language-(\w+)/.exec(className ?? '')
    const language = match?.[1]
    const code = String(children).replace(/\n$/, '')

    if (language) {
        return <CliCodeBlockInner language={language} code={code} />
    }

    return (
        <code
            {...rest}
            className={cn(
                'break-words rounded-md bg-[var(--app-inline-code-bg)] px-[0.3em] py-[0.1em] text-[0.9em]',
                className
            )}
        >
            {children}
        </code>
    )
}

function CliPre(props: ComponentPropsWithoutRef<'pre'>) {
    return <>{props.children}</>
}

const cliMarkdownComponents = {
    code: CliCodeBlock,
    pre: CliPre,
    p: (props: ComponentPropsWithoutRef<'p'>) => (
        <p {...props} className="aui-md-p mb-1 leading-relaxed break-words [overflow-wrap:anywhere]" />
    ),
    a: (props: ComponentPropsWithoutRef<'a'>) => (
        <a {...props} className="text-[var(--social-fg)] underline" rel={props.target === '_blank' ? 'noreferrer' : undefined} />
    ),
    blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote {...props} className="border-l-4 border-[var(--social-fg-muted)] pl-3 opacity-85 break-words" />
    ),
    ul: (props: ComponentPropsWithoutRef<'ul'>) => (
        <ul {...props} className="aui-md-ul list-disc pl-5 my-0.5" />
    ),
    ol: (props: ComponentPropsWithoutRef<'ol'>) => (
        <ol {...props} className="aui-md-ol list-decimal pl-5 my-0.5" />
    ),
    li: (props: ComponentPropsWithoutRef<'li'>) => (
        <li {...props} className="aui-md-li my-0" />
    ),
    hr: (props: ComponentPropsWithoutRef<'hr'>) => (
        <hr {...props} className="border-[var(--social-divider)] my-1" />
    ),
    table: (props: ComponentPropsWithoutRef<'table'>) => (
        <div className="max-w-full overflow-x-auto my-1">
            <table {...props} className="w-full border-collapse text-[length:inherit]" />
        </div>
    ),
    th: (props: ComponentPropsWithoutRef<'th'>) => (
        <th {...props} className="border border-[var(--social-border)] px-2 py-1 text-left font-semibold bg-[var(--social-hover)]" />
    ),
    td: (props: ComponentPropsWithoutRef<'td'>) => (
        <td {...props} className="border border-[var(--social-border)] px-2 py-1" />
    ),
}

export const CliAgentTextBlock = memo(function CliAgentTextBlock(props: { block: AgentTextBlock }) {
    return (
        <div className="py-0.5 cli-agent-text aui-md min-w-0 max-w-full break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={cliMarkdownComponents}
            >
                {props.block.text}
            </ReactMarkdown>
        </div>
    )
})

export const CliCliOutputBlock = memo(function CliCliOutputBlock(props: { block: CliOutputBlock }) {
    const { block } = props
    const isUser = block.source === 'user'
    return (
        <div className={`py-0.5 ${isUser ? 'text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]'}`}>
            <pre className="whitespace-pre-wrap break-words text-[length:inherit] leading-relaxed">{block.text}</pre>
        </div>
    )
})
