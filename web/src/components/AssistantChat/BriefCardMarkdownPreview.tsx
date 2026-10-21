import type { ComponentPropsWithoutRef, CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'

import { MARKDOWN_PLUGINS, defaultComponents } from '@/components/assistant-ui/markdown-text'
import { cn } from '@/lib/utils'

type BriefCardMarkdownPreviewProps = {
    content: string
    className?: string
    style?: CSSProperties
}

const briefPreviewComponents = {
    ...defaultComponents,
    a: (props: ComponentPropsWithoutRef<'a'>) => (
        <span
            className={cn('aui-md-a underline decoration-dotted [color:inherit] opacity-90', props.className)}
            title={props.title ?? props.href}
        >
            {props.children}
        </span>
    )
}

export function BriefCardMarkdownPreview(props: BriefCardMarkdownPreviewProps) {
    return (
        <div
            className={cn('overflow-y-hidden', props.className)}
            style={props.style}
        >
            <div
                className={cn(
                    'aui-md min-w-0 max-w-full break-words text-body leading-[1.4rem] [overflow-wrap:anywhere]',
                    '[&_.aui-md-p]:m-0',
                    '[&_.aui-md-p+_.aui-md-p]:mt-1',
                    '[&_.aui-md-h1]:mt-0 [&_.aui-md-h1]:text-body',
                    '[&_.aui-md-h2]:mt-0 [&_.aui-md-h2]:text-body',
                    '[&_.aui-md-h3]:mt-0 [&_.aui-md-h3]:text-body',
                    '[&_.aui-md-h4]:mt-0 [&_.aui-md-h4]:text-body',
                    '[&_.aui-md-h5]:mt-0 [&_.aui-md-h5]:text-body',
                    '[&_.aui-md-h6]:mt-0 [&_.aui-md-h6]:text-body',
                    '[&_.aui-md-ul]:my-0 [&_.aui-md-ol]:my-0',
                    '[&_.aui-md-li]:my-0',
                    '[&_.aui-md-blockquote]:my-0'
                )}
            >
                <ReactMarkdown
                    remarkPlugins={[remarkBreaks, ...MARKDOWN_PLUGINS]}
                    components={briefPreviewComponents}
                >
                    {props.content}
                </ReactMarkdown>
            </div>
        </div>
    )
}
