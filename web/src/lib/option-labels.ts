import { getPermissionModeLabel, type PermissionMode } from '@hapi/protocol'

type Translate = (key: string, params?: Record<string, string | number>) => string

function translateOr(t: Translate, key: string, fallback: string): string {
    const text = t(key)
    return text === key ? fallback : text
}

/** Protocol labels are English; show permission modes in the UI language. */
export function permissionModeText(mode: PermissionMode, t: Translate): string {
    return translateOr(t, `permissionMode.${mode}`, getPermissionModeLabel(mode))
}

/** Model names stay as they are; only the generic words around them are translated. */
export function modelOptionText(value: string, label: string, t: Translate): string {
    if (value === 'auto') return translateOr(t, 'modelOption.default', label)
    const latest = /^(Sonnet|Opus|Haiku) \(latest\)$/.exec(label)
    if (latest) return t('modelOption.latest', { name: latest[1] })
    return label
}

export function thinkEffortText(value: string, label: string, t: Translate): string {
    return translateOr(t, `thinkEffort.${value}`, label)
}

export function serviceTierText(value: string, label: string, t: Translate): string {
    return translateOr(t, `serviceTier.${value}`, label)
}
