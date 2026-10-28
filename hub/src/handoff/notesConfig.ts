import { existsSync } from 'node:fs'

import { readSettings } from '../config/settings'
import { normalizeFolder, type NotesConfig } from './handoff'

function zoneName(timeZone: string): string {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date())
        .find((entry) => entry.type === 'timeZoneName')
    return part?.value ?? timeZone
}

/** The notes folder from settings.json `handoffNotes`; null (export off) when unset or not on this machine. */
export async function loadNotesConfig(settingsFile: string): Promise<NotesConfig | null> {
    const notes = (await readSettings(settingsFile))?.handoffNotes
    const root = notes?.root?.trim()
    if (!root || !existsSync(root)) return null
    const index = notes?.index?.trim() || 'HAQI 交接总入口.md'
    const inbox = normalizeFolder(notes?.inbox?.trim() || 'HAQI 待归档') ?? 'HAQI 待归档'
    const timeZone = notes?.timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone
    return { root, index, inbox, timeZone, zoneLabel: notes?.zoneLabel?.trim() || zoneName(timeZone) }
}
