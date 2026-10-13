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

export function CopyPlusIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <rect x="8" y="8" width="13" height="13" rx="2" />
            <path d="M4 16V5a2 2 0 0 1 2-2h11" />
            <line x1="14.5" y1="11.5" x2="14.5" y2="17.5" />
            <line x1="11.5" y1="14.5" x2="17.5" y2="14.5" />
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

export function ChecklistIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <polyline points="4 7 5.5 8.5 8 6" />
            <polyline points="4 13 5.5 14.5 8 12" />
            <line x1="11" y1="7.5" x2="20" y2="7.5" />
            <line x1="11" y1="13.5" x2="20" y2="13.5" />
            <line x1="11" y1="19" x2="20" y2="19" />
            <circle cx="5.8" cy="19" r="1.1" />
        </Svg>
    )
}
