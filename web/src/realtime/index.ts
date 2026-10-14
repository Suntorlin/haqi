// Types
export type { VoiceSession, VoiceSessionConfig, ConversationStatus, ConversationMode } from './types'

// Session management
export {
    startRealtimeSession,
    stopRealtimeSession,
    registerVoiceSession,
    isVoiceSessionStarted,
    getVoiceSession,
    getCurrentRealtimeSessionId,
    updateCurrentSessionId
} from './RealtimeSession'

// Client tools
export { realtimeClientTools, registerSessionStore } from './realtimeClientTools'

// The voice session component is not re-exported: importing it pulls the ElevenLabs SDK (~470KB) into
// the first load. SessionChat loads it lazily from './RealtimeVoiceSession'.
export type { RealtimeVoiceSessionProps } from './RealtimeVoiceSession'

// Voice hooks
export { voiceHooks, registerVoiceHooksStore, setVoicePureContextModeEnabled } from './hooks/voiceHooks'

// Context formatters
export {
    formatMessage,
    formatNewSingleMessage,
    formatNewMessages,
    formatHistory,
    formatSessionFull,
    formatSessionOnline,
    formatSessionOffline,
    formatSessionFocus,
    formatPermissionRequest,
    formatReadyEvent
} from './hooks/contextFormatters'

// Config
export { VOICE_CONFIG } from './voiceConfig'
