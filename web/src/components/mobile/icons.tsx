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
            <path d="M15 9l-6 6M9 9l6 6" stroke="var(--social-surface)" strokeWidth="2" strokeLinecap="round" />
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

/** Folder: projects, directories. */
export function FolderIcon(props: IconProps) {
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
            <circle cx="9" cy="7" r="2.2" fill="var(--social-surface)" />
            <circle cx="15" cy="17" r="2.2" fill="var(--social-surface)" />
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

export function MoonIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </Svg>
    )
}

export function SunIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
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

/** Copy text or code to the clipboard. Same glyph as `DuplicateIcon`. */
export const CopyIcon = DuplicateIcon

export function ChevronRightIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <polyline points="9 18 15 12 9 6" />
        </Svg>
    )
}

/** Disclosure chevron: points right when closed, turns down when `open` (collapsible groups, trees). */
export function DisclosureIcon(props: IconProps & { open: boolean }) {
    return (
        <ChevronRightIcon
            className={`${props.className ?? 'h-4 w-4'} transition-transform duration-200 ${props.open ? 'rotate-90' : ''}`}
        />
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

/** Microphone; `muted` adds the slash used by mute toggles. */
export function MicIcon(props: IconProps & { muted?: boolean }) {
    return (
        <Svg className={props.className} strokeWidth={1.8}>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <line x1="12" y1="18" x2="12" y2="21" />
            {props.muted ? <line x1="4" y1="4" x2="20" y2="20" /> : null}
        </Svg>
    )
}

export function ChevronDownIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <polyline points="6 9 12 15 18 9" />
        </Svg>
    )
}

export function CloseIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
        </Svg>
    )
}

export function SwapIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <polyline points="17 3 21 7 17 11" />
            <line x1="21" y1="7" x2="8" y2="7" />
            <polyline points="7 13 3 17 7 21" />
            <line x1="3" y1="17" x2="16" y2="17" />
        </Svg>
    )
}

export function CheckIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2.4}>
            <polyline points="5 12.5 10 17.5 19 7" />
        </Svg>
    )
}

export function ArrowUpIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="6 11 12 5 18 11" />
        </Svg>
    )
}

export function ArrowDownIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="6 13 12 19 18 13" />
        </Svg>
    )
}

export function ExternalLinkIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <path d="M14 4h6v6" />
            <line x1="20" y1="4" x2="11" y2="13" />
            <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
        </Svg>
    )
}

export function RefreshIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <path d="M20 12a8 8 0 1 1-2.6-5.9" />
            <polyline points="20 4 20 9 15 9" />
        </Svg>
    )
}

export function LockIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <rect x="5" y="11" width="14" height="9.5" rx="2.5" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </Svg>
    )
}

/** Arrows folding onto a line: squeeze the conversation into a summary ("/compact"). */
export function CompactIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <line x1="12" y1="2.5" x2="12" y2="8.5" />
            <polyline points="8.5 5.5 12 9 15.5 5.5" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <polyline points="8.5 18.5 12 15 15.5 18.5" />
            <line x1="12" y1="15" x2="12" y2="21.5" />
        </Svg>
    )
}

export function MinusIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <line x1="5" y1="12" x2="19" y2="12" />
        </Svg>
    )
}

/** iOS share sheet (box with an up arrow). */
export function ShareIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3v12" />
        </Svg>
    )
}

/** Drag handle. */
export function GripIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={props.className ?? 'h-4 w-4'} aria-hidden="true">
            <circle cx="9" cy="6" r="1.8" />
            <circle cx="15" cy="6" r="1.8" />
            <circle cx="9" cy="12" r="1.8" />
            <circle cx="15" cy="12" r="1.8" />
            <circle cx="9" cy="18" r="1.8" />
            <circle cx="15" cy="18" r="1.8" />
        </svg>
    )
}

export function GitBranchIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
        </Svg>
    )
}

/** Show / hide the side list. */
export function SidebarIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9.5 4v16" />
        </Svg>
    )
}

export function LanguageIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <path d="m5 8 6 6" />
            <path d="m4 14 6-6 2-3" />
            <path d="M2 5h12" />
            <path d="M7 2h1" />
            <path d="m22 22-5-10-5 10" />
            <path d="M14 18h6" />
        </Svg>
    )
}

/** Fit everything into view (graph "show all"). */
export function FitViewIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </Svg>
    )
}

/** Error / failed state. */
export function AlertCircleIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="7.5" x2="12" y2="13.5" />
            <circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
        </Svg>
    )
}

/** Done / succeeded state. */
export function CheckCircleIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <polyline points="7.8 12.4 10.5 15.1 16.2 9" />
        </Svg>
    )
}

/** Failed / rejected state. */
export function XCircleIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path d="M8.4 8.4l7.2 7.2M15.6 8.4l-7.2 7.2" />
        </Svg>
    )
}

/* Tool kinds (tool cards). */

export function EyeIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
            <circle cx="12" cy="12" r="2.5" />
        </Svg>
    )
}

export function FileDiffIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
            <path d="M14 2v5h5" />
            <path d="M9 12h2" />
            <path d="M9 16h6" />
            <path d="M13 12h2" />
        </Svg>
    )
}

/** The web (fetch / search). The browser-window glyph is `GlobeIcon`. */
export function WebIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a12 12 0 0 1 0 18" />
            <path d="M12 3a12 12 0 0 0 0 18" />
        </Svg>
    )
}

export function ClipboardIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <rect x="8" y="3" width="8" height="4" rx="1" />
            <path d="M9 7H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
        </Svg>
    )
}

export function PuzzleIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M9 3a2 2 0 0 1 2 2v1h2V5a2 2 0 1 1 4 0v3h-3v2h1a2 2 0 1 1 0 4h-1v2h3v3H6a2 2 0 0 1-2-2v-3h3v-2H6a2 2 0 1 1 0-4h1V8H4V5a2 2 0 0 1 2-2h3z" />
        </Svg>
    )
}

export function RocketIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M12 2c4 1 6 4 7 8-2 1-4 2-7 2s-5-1-7-2c1-4 3-7 7-8z" />
            <path d="M9 14l-2 6 5-3" />
            <path d="M15 14l2 6-5-3" />
            <circle cx="12" cy="8.5" r="1.2" />
        </Svg>
    )
}

export function WrenchIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M21 7a5 5 0 0 1-7 4L7 18a2 2 0 0 1-3-3l7-7a5 5 0 0 1 6-6l-3 3 4 4 3-3z" />
        </Svg>
    )
}

export function QuestionIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9a2.5 2.5 0 1 1 4.1 1.9c-.9.7-1.6 1.3-1.6 2.6" />
            <path d="M12 17h.01" />
        </Svg>
    )
}

export function UsersIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Svg>
    )
}

export function MessageSquareIcon(props: IconProps) {
    return (
        <Svg {...props} strokeWidth={1.8}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </Svg>
    )
}

/* Tab bar: outline when idle, filled when the tab is active. */

type TabIconProps = IconProps & { filled: boolean }

export function ChatsIcon(props: TabIconProps) {
    return (
        <svg viewBox="0 0 24 24" className={props.className ?? 'h-[25px] w-[25px]'} fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.7} strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3.5c-4.97 0-9 3.47-9 7.75 0 2.33 1.2 4.42 3.09 5.84-.13 1.17-.62 2.33-1.44 3.25 1.9-.12 3.56-.8 4.73-1.73.84.25 1.72.39 2.62.39 4.97 0 9-3.47 9-7.75S16.97 3.5 12 3.5z" />
        </svg>
    )
}

export function GroupsIcon(props: TabIconProps) {
    return (
        <svg viewBox="0 0 24 24" className={props.className ?? 'h-[25px] w-[25px]'} fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="8.5" r="3.5" />
            <path d="M2.5 19.5c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5z" />
            <circle cx="16.8" cy="9.2" r="2.7" />
            <path d="M16.6 13.6c2.6.1 4.4 1.9 4.9 4.9h-4.1" />
        </svg>
    )
}

export function MemoryIcon(props: TabIconProps) {
    return (
        <svg viewBox="0 0 24 24" className={props.className ?? 'h-[25px] w-[25px]'} fill="none" stroke="currentColor" strokeWidth={props.filled ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="5" r="2.2" fill={props.filled ? 'currentColor' : 'none'} />
            <circle cx="5.5" cy="12.5" r="2.2" />
            <circle cx="18.5" cy="12.5" r="2.2" />
            <circle cx="9" cy="19.5" r="2" />
            <circle cx="15" cy="19.5" r="2" />
            <path d="M10.5 6.6 6.9 10.6M13.5 6.6l3.6 4M6.6 14.5l1.7 3.1M17.4 14.5l-1.7 3.1" />
        </svg>
    )
}

export function MeIcon(props: TabIconProps) {
    return (
        <svg viewBox="0 0 24 24" className={props.className ?? 'h-[25px] w-[25px]'} fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20.5c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5z" />
        </svg>
    )
}
