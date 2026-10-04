import { getPermissionModeLabel, getPermissionModeTone, isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import type { PermissionModeTone } from '@hapi/protocol'
import type { ClaudeRateLimitSnapshot } from '@hapi/protocol/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentState, ModelMode, PermissionMode } from '@/types/api'
import type { ConversationStatus } from '@/realtime/types'
import { getContextBudgetTokens } from '@/chat/modelConfig'
import { useTranslation } from '@/lib/use-translation'
import { UsagePanel } from './UsagePanel'

// Vibing messages for thinking state
const VIBING_MESSAGES = [
    "Accomplishing", "Actioning", "Actualizing", "Baking", "Booping", "Brewing",
    "Calculating", "Cerebrating", "Channelling", "Churning", "Clauding", "Coalescing",
    "Cogitating", "Computing", "Combobulating", "Concocting", "Conjuring", "Considering",
    "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Deciphering",
    "Deliberating", "Determining", "Discombobulating", "Divining", "Doing", "Effecting",
    "Elucidating", "Enchanting", "Envisioning", "Finagling", "Flibbertigibbeting",
    "Forging", "Forming", "Frolicking", "Generating", "Germinating", "Hatching",
    "Herding", "Honking", "Ideating", "Imagining", "Incubating", "Inferring",
    "Manifesting", "Marinating", "Meandering", "Moseying", "Mulling", "Mustering",
    "Musing", "Noodling", "Percolating", "Perusing", "Philosophising", "Pontificating",
    "Pondering", "Processing", "Puttering", "Puzzling", "Reticulating", "Ruminating",
    "Scheming", "Schlepping", "Shimmying", "Simmering", "Smooshing", "Spelunking",
    "Spinning", "Stewing", "Sussing", "Synthesizing", "Thinking", "Tinkering",
    "Transmuting", "Unfurling", "Unravelling", "Vibing", "Wandering", "Whirring",
    "Wibbling", "Wizarding", "Working", "Wrangling"
]

const PERMISSION_TONE_CLASSES: Record<PermissionModeTone, string> = {
    neutral: 'text-[var(--app-hint)]',
    info: 'text-blue-500',
    warning: 'text-amber-500',
    danger: 'text-red-500'
}

function getConnectionStatus(
    active: boolean,
    thinking: boolean,
    agentState: AgentState | null | undefined,
    voiceStatus: ConversationStatus | undefined,
    t: (key: string) => string
): { text: string; color: string; dotColor: string; isPulsing: boolean } {
    const hasPermissions = agentState?.requests && Object.keys(agentState.requests).length > 0
    const runningAgents = agentState?.runningAgents ?? (agentState?.runningAgent ? [agentState.runningAgent] : [])
    const runningAgent = runningAgents[runningAgents.length - 1] ?? null

    // Voice connecting takes priority
    if (voiceStatus === 'connecting') {
        return {
            text: t('voice.connecting'),
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    if (!active) {
        return {
            text: t('misc.offline'),
            color: 'text-[#999]',
            dotColor: 'bg-[#999]',
            isPulsing: false
        }
    }

    if (hasPermissions) {
        return {
            text: t('misc.permissionRequired'),
            color: 'text-[#FF9500]',
            dotColor: 'bg-[#FF9500]',
            isPulsing: true
        }
    }

    if (thinking) {
        const agentName = typeof runningAgent?.name === 'string' ? runningAgent.name.trim() : ''
        const vibingMessage = runningAgents.length > 1
            ? `Running ${runningAgents.length} agents…`
            : agentName.length > 0
                ? `Running ${agentName}…`
                : VIBING_MESSAGES[Math.floor(Math.random() * VIBING_MESSAGES.length)].toLowerCase() + '…'
        return {
            text: vibingMessage,
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    return {
        text: t('misc.online'),
        color: 'text-[#34C759]',
        dotColor: 'bg-[#34C759]',
        isPulsing: false
    }
}

function getContextWarning(contextSize: number, maxContextSize: number, t: (key: string, params?: Record<string, string | number>) => string): { text: string; color: string } | null {
    const percentageUsed = (contextSize / maxContextSize) * 100
    const percentageRemaining = Math.max(0, 100 - percentageUsed)

    const percent = Math.round(percentageRemaining)
    if (percentageRemaining <= 5) {
        return { text: t('misc.percentLeft', { percent }), color: 'text-red-500' }
    } else if (percentageRemaining <= 10) {
        return { text: t('misc.percentLeft', { percent }), color: 'text-amber-500' }
    } else {
        return { text: t('misc.percentLeft', { percent }), color: 'text-[var(--app-hint)]' }
    }
}

export function StatusBar(props: {
    active: boolean
    thinking: boolean
    agentState: AgentState | null | undefined
    contextSize?: number
    contextWindowTokens?: number
    modelMode?: ModelMode
    permissionMode?: PermissionMode
    agentFlavor?: string | null
    collaborationMode?: string
    voiceStatus?: ConversationStatus
    rateLimitSnapshot?: ClaudeRateLimitSnapshot
}) {
    const { t } = useTranslation()
    const connectionStatus = useMemo(
        () => getConnectionStatus(props.active, props.thinking, props.agentState, props.voiceStatus, t),
        [props.active, props.thinking, props.agentState, props.voiceStatus, t]
    )

    const maxContextSize = useMemo(
        () => props.contextWindowTokens ?? getContextBudgetTokens(props.modelMode),
        [props.contextWindowTokens, props.modelMode]
    )

    const contextWarning = useMemo(
        () => {
            if (props.contextSize === undefined) return null
            if (!maxContextSize) return null
            return getContextWarning(props.contextSize, maxContextSize, t)
        },
        [props.contextSize, maxContextSize, t]
    )

    const [usageOpen, setUsageOpen] = useState(false)
    const usageRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        if (!usageOpen) return
        const handler = (event: MouseEvent) => {
            if (!usageRef.current) return
            if (!usageRef.current.contains(event.target as Node)) {
                setUsageOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [usageOpen])

    const showUsageButton = props.agentFlavor === 'claude'
        && (typeof props.contextSize === 'number' || Boolean(props.rateLimitSnapshot))

    const fiveHourUtilization = props.rateLimitSnapshot?.five_hour?.utilization
    const remainingPercent = typeof fiveHourUtilization === 'number'
        ? Math.max(0, Math.round((1 - fiveHourUtilization) * 100))
        : null
    const usageTone = remainingPercent !== null && remainingPercent <= 10
        ? 'text-red-500'
        : remainingPercent !== null && remainingPercent <= 30
            ? 'text-amber-500'
            : 'text-[var(--app-hint)] hover:text-[var(--app-text)]'

    const permissionMode = props.permissionMode
    const runningAgents = props.agentState?.runningAgents ?? (props.agentState?.runningAgent ? [props.agentState.runningAgent] : [])
    const displayPermissionMode = permissionMode
        && permissionMode !== 'default'
        && isPermissionModeAllowedForFlavor(permissionMode, props.agentFlavor)
        ? permissionMode
        : null

    const permissionModeLabel = displayPermissionMode ? getPermissionModeLabel(displayPermissionMode) : null
    const permissionModeTone = displayPermissionMode ? getPermissionModeTone(displayPermissionMode) : null
    const permissionModeColor = permissionModeTone ? PERMISSION_TONE_CLASSES[permissionModeTone] : 'text-[var(--app-hint)]'
    const normalizedCollaborationMode = typeof props.collaborationMode === 'string'
        ? props.collaborationMode.trim().toLowerCase()
        : ''
    const isCodexPlanMode = props.agentFlavor === 'codex' && normalizedCollaborationMode === 'plan'
    const codexModeLabel = props.agentFlavor === 'codex'
        ? (isCodexPlanMode ? t('codex.mode.plan') : t('codex.mode.normal'))
        : null

    return (
        <div className="flex items-start justify-between gap-3 px-2 pb-1">
            <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-1.5">
                    <span
                        className={`h-2 w-2 rounded-full ${connectionStatus.dotColor} ${connectionStatus.isPulsing ? 'animate-pulse' : ''}`}
                    />
                    <span className={`text-xs ${connectionStatus.color}`}>
                        {connectionStatus.text}
                    </span>
                    {codexModeLabel ? (
                        <span className={`text-[10px] ${isCodexPlanMode ? 'text-blue-500' : 'text-[var(--app-hint)]'}`}>
                            {codexModeLabel}
                        </span>
                    ) : null}
                </div>
                {runningAgents.length > 1 ? (
                    <div className="flex flex-wrap gap-1 pl-3.5">
                        {runningAgents.map((agent, index) => {
                            const label = agent.task ? `${agent.name}: ${agent.task}` : agent.name
                            return (
                                <span
                                    key={`${agent.name}:${agent.startedAt ?? index}`}
                                    className="max-w-[220px] truncate rounded-full bg-[var(--app-subtle-bg)] px-2 py-0.5 text-[10px] text-[var(--app-hint)]"
                                    title={label}
                                >
                                    {label}
                                </span>
                            )
                        })}
                    </div>
                ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {contextWarning ? (
                    <span className={`text-[10px] ${contextWarning.color}`}>
                        {contextWarning.text}
                    </span>
                ) : null}
                {showUsageButton ? (
                    <div className="relative" ref={usageRef}>
                        <button
                            type="button"
                            onClick={() => setUsageOpen((prev) => !prev)}
                            className={`rounded-full border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2 py-0.5 text-[10px] transition-colors ${usageTone}`}
                            title={t('usage.tooltip')}
                        >
                            {remainingPercent === null ? t('usage.label') : t('usage.remainingShort', { percent: remainingPercent })}
                        </button>
                        {usageOpen ? (
                            <div className="absolute bottom-full right-0 z-30 mb-1.5">
                                <UsagePanel
                                    contextSize={props.contextSize}
                                    contextWindowTokens={props.contextWindowTokens}
                                    rateLimitSnapshot={props.rateLimitSnapshot}
                                />
                            </div>
                        ) : null}
                    </div>
                ) : null}
                {displayPermissionMode ? (
                    <span className={`text-xs ${permissionModeColor}`}>
                        {permissionModeLabel}
                    </span>
                ) : null}
            </div>
        </div>
    )
}
