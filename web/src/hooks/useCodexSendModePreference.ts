import { useCallback, useEffect, useState } from 'react'
import type { CodexSendMode } from '@/components/AssistantChat/HappyComposer'

const CODEX_SEND_MODE_DEFAULT_KEY = 'hapi:codexSendModeDefault'

// Queue is the default for every session: messages sent while the agent runs wait in line instead of interrupting it.
function normalizeCodexSendMode(value: string | null): CodexSendMode {
    return value === 'direct' ? 'direct' : 'queue'
}

export function safeReadCodexSendModeDefault(): CodexSendMode {
    if (typeof window === 'undefined') {
        return 'queue'
    }
    try {
        return normalizeCodexSendMode(window.localStorage.getItem(CODEX_SEND_MODE_DEFAULT_KEY))
    } catch {
        return 'queue'
    }
}

function safeWriteCodexSendModeDefault(value: CodexSendMode): void {
    if (typeof window === 'undefined') {
        return
    }
    try {
        window.localStorage.setItem(CODEX_SEND_MODE_DEFAULT_KEY, value)
    } catch {
        // Ignore storage errors
    }
}

export function useCodexSendModePreference(): {
    codexSendModeDefault: CodexSendMode
    setCodexSendModeDefault: (mode: CodexSendMode) => void
} {
    const [codexSendModeDefault, setCodexSendModeDefaultState] = useState<CodexSendMode>(safeReadCodexSendModeDefault)

    const setCodexSendModeDefault = useCallback((mode: CodexSendMode) => {
        setCodexSendModeDefaultState(mode)
        safeWriteCodexSendModeDefault(mode)
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        const handleStorage = (event: StorageEvent) => {
            if (event.key !== CODEX_SEND_MODE_DEFAULT_KEY) {
                return
            }
            setCodexSendModeDefaultState(normalizeCodexSendMode(event.newValue))
        }

        window.addEventListener('storage', handleStorage)
        return () => window.removeEventListener('storage', handleStorage)
    }, [])

    return {
        codexSendModeDefault,
        setCodexSendModeDefault
    }
}
