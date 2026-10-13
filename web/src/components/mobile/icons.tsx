type IconProps = { className?: string }

function Svg(props: IconProps & { children: React.ReactNode; strokeWidth?: number; fill?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill={props.fill ?? 'none'}
            stroke="currentColor"
            strokeWidth={props.strokeWidth ?? 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className ?? 'h-5 w-5'}
            aria-hidden="true"
        >
            {props.children}
        </svg>
    )
}

export function SearchIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <circle cx="11" cy="11" r="7" />
            <line x1="20.5" y1="20.5" x2="16.2" y2="16.2" />
        </Svg>
    )
}

export function ClearIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 24 24" className={props.className ?? 'h-4 w-4'} aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="currentColor" />
            <path d="M15 9l-6 6M9 9l6 6" stroke="var(--app-bg)" strokeWidth="2" strokeLinecap="round" />
        </svg>
    )
}

export function PlusCircleIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9.5" />
            <line x1="12" y1="7.5" x2="12" y2="16.5" />
            <line x1="7.5" y1="12" x2="16.5" y2="12" />
        </Svg>
    )
}

export function FolderStackIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
        </Svg>
    )
}

export function RecentIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14" />
        </Svg>
    )
}

export function ChevronLeftIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2.2}>
            <polyline points="15 18 9 12 15 6" />
        </Svg>
    )
}

export function MoreHorizontalIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={props.className ?? 'h-5 w-5'} aria-hidden="true">
            <circle cx="5" cy="12" r="1.9" />
            <circle cx="12" cy="12" r="1.9" />
            <circle cx="19" cy="12" r="1.9" />
        </svg>
    )
}

export function PlusIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </Svg>
    )
}

export function FileIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" />
            <path d="M14 2.5v5h5" />
        </Svg>
    )
}

export function TerminalIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <polyline points="7 9 10 12 7 15" />
            <line x1="12" y1="15" x2="17" y2="15" />
        </Svg>
    )
}

export function GlobeIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M3 9h18" />
            <path d="M7 6.5h.01" />
            <path d="M10 6.5h.01" />
        </Svg>
    )
}

export function PlugIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M12 2v7" />
            <path d="M9 5h6" />
            <path d="M6 9h12v2a6 6 0 0 1-12 0z" />
            <path d="M12 17v5" />
        </Svg>
    )
}

export function SlidersIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="17" x2="20" y2="17" />
            <circle cx="9" cy="7" r="2.2" fill="var(--app-bg)" />
            <circle cx="15" cy="17" r="2.2" fill="var(--app-bg)" />
        </Svg>
    )
}

export function PaperclipIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78" />
        </Svg>
    )
}

export function StopSquareIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={props.className ?? 'h-4 w-4'} aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2.5" />
        </svg>
    )
}

export function SendArrowIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2.4}>
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
        </Svg>
    )
}

export function QueueListIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="16" y2="12" />
            <line x1="4" y1="18" x2="12" y2="18" />
        </Svg>
    )
}

export function InfoCircleIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16" />
            <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
        </Svg>
    )
}

export function SwitchIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <polyline points="17 3 21 7 17 11" />
            <path d="M3 7h18" />
            <polyline points="7 21 3 17 7 13" />
            <path d="M21 17H3" />
        </Svg>
    )
}

export function MicWaveIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <line x1="6" y1="10" x2="6" y2="14" />
            <line x1="10" y1="7" x2="10" y2="17" />
            <line x1="14" y1="9" x2="14" y2="15" />
            <line x1="18" y1="11" x2="18" y2="13" />
        </Svg>
    )
}

export function PencilIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </Svg>
    )
}

export function ArchiveBoxIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <rect x="3" y="4" width="18" height="5" rx="1" />
            <path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
            <line x1="10" y1="13" x2="14" y2="13" />
        </Svg>
    )
}

export function TrashIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </Svg>
    )
}

export function SpeakerIcon(props: IconProps & { muted?: boolean }) {
    return (
        <Svg className={props.className}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {props.muted ? (
                <>
                    <line x1="22" y1="9" x2="16" y2="15" />
                    <line x1="16" y1="9" x2="22" y2="15" />
                </>
            ) : (
                <>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </>
            )}
        </Svg>
    )
}

export function PinIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </Svg>
    )
}

export function PinOffIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M12 17v5" />
            <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" />
            <path d="m2 2 20 20" />
            <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
        </Svg>
    )
}

export function TagIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.83 0l3.35-3.35a2 2 0 0 0 0-2.83Z" />
            <circle cx="7.5" cy="6.5" r=".6" fill="currentColor" />
        </Svg>
    )
}

/** New session (same config / in this project). */
export function NewSessionIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M12 18v-6" />
            <path d="M9 15h6" />
        </Svg>
    )
}

/** Duplicate a session together with its history. */
export function DuplicateIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </Svg>
    )
}

export function ChevronRightIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <polyline points="9 18 15 12 9 6" />
        </Svg>
    )
}

/** Plan mode: plan first, run after approval. */
export function PlanIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="m3 17 2 2 4-4" />
            <path d="m3 7 2 2 4-4" />
            <path d="M13 6h8" />
            <path d="M13 12h8" />
            <path d="M13 18h8" />
        </Svg>
    )
}

/** Project offline toggle. */
export function BulbIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z" />
        </Svg>
    )
}

/** Reply / quote a message. */
export function ReplyIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <polyline points="9 17 4 12 9 7" />
            <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
        </Svg>
    )
}

/** Ask the note executor to regenerate the group note. */
export function SparklesIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
            <path d="M19 3v4" />
            <path d="M21 5h-4" />
        </Svg>
    )
}

/** Broadcast to every group member. */
export function MegaphoneIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </Svg>
    )
}

/** Open a member's own chat. */
export function ChatBubbleIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.4 9.4 0 0 1-3.9-.8L3 20.5l1.4-4.3A8 8 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 9 8.4z" />
        </Svg>
    )
}

/** Permission requests waiting for approval. */
export function ShieldCheckIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <polyline points="9 12 11 14 15 10" />
        </Svg>
    )
}
