import { Hono } from 'hono'
import { z } from 'zod'

import { configuration } from '../../configuration'
import {
    getNewSessionDefaultsStore,
    newSessionDefaultsSchema,
    type NewSessionDefaultsStore
} from '../../config/newSessionDefaults'
import { readSettingsOrThrow, writeSettings } from '../../config/settings'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

const updateProjectOfflineSchema = z.object({
    directories: z.array(z.string()).max(500)
})

const updateExperimentalSettingsSchema = z.object({
    claudeLoginShell: z.boolean().optional(),
    codexReportPromptEnabled: z.boolean().optional(),
    previewEnabled: z.boolean().optional()
}).superRefine((value, ctx) => {
    if (
        value.claudeLoginShell === undefined
        && value.codexReportPromptEnabled === undefined
        && value.previewEnabled === undefined
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'At least one experimental setting must be provided'
        })
    }
})

const DEFAULT_EXPERIMENTAL_CLAUDE_LOGIN_SHELL = false
const DEFAULT_CODEX_REPORT_PROMPT_ENABLED = false
const DEFAULT_PREVIEW_ENABLED = true

function normalizeDirectories(directories: string[]): string[] {
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const directory of directories) {
        const trimmed = directory.trim()
        if (!trimmed || seen.has(trimmed)) {
            continue
        }
        seen.add(trimmed)
        normalized.push(trimmed)
    }
    return normalized
}

export function createSettingsRoutes(
    store: Store,
    getNewSessionDefaults: () => NewSessionDefaultsStore = getNewSessionDefaultsStore
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/settings/experimental', async (c) => {
        try {
            const settings = await readSettingsOrThrow(configuration.settingsFile)
            return c.json({
                settings: {
                    claudeLoginShell: settings.experimentalClaudeLoginShell ?? DEFAULT_EXPERIMENTAL_CLAUDE_LOGIN_SHELL,
                    codexReportPromptEnabled: settings.codexReportPromptEnabled ?? DEFAULT_CODEX_REPORT_PROMPT_ENABLED,
                    previewEnabled: settings.previewEnabled ?? DEFAULT_PREVIEW_ENABLED
                }
            })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to load experimental settings'
            }, 500)
        }
    })

    app.patch('/settings/experimental', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = updateExperimentalSettingsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const settings = await readSettingsOrThrow(configuration.settingsFile)
            if (parsed.data.claudeLoginShell !== undefined) {
                settings.experimentalClaudeLoginShell = parsed.data.claudeLoginShell
            }
            if (parsed.data.codexReportPromptEnabled !== undefined) {
                settings.codexReportPromptEnabled = parsed.data.codexReportPromptEnabled
            }
            if (parsed.data.previewEnabled !== undefined) {
                settings.previewEnabled = parsed.data.previewEnabled
            }
            await writeSettings(configuration.settingsFile, settings)
            return c.json({
                settings: {
                    claudeLoginShell: settings.experimentalClaudeLoginShell ?? DEFAULT_EXPERIMENTAL_CLAUDE_LOGIN_SHELL,
                    codexReportPromptEnabled: settings.codexReportPromptEnabled ?? DEFAULT_CODEX_REPORT_PROMPT_ENABLED,
                    previewEnabled: settings.previewEnabled ?? DEFAULT_PREVIEW_ENABLED
                }
            })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to update experimental settings'
            }, 500)
        }
    })

    app.get('/settings/project-offline', (c) => {
        try {
            const namespace = c.get('namespace')
            const userId = c.get('userId')
            const directories = store.projectPreferences.getProjectOfflineDirectories(namespace, userId)
            return c.json({ directories })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to load project offline settings'
            }, 500)
        }
    })

    app.put('/settings/project-offline', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = updateProjectOfflineSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const namespace = c.get('namespace')
            const userId = c.get('userId')
            const directories = store.projectPreferences.replaceProjectOfflineDirectories(
                namespace,
                userId,
                normalizeDirectories(parsed.data.directories)
            )
            return c.json({ directories })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to update project offline settings'
            }, 500)
        }
    })

    app.get('/settings/new-session-defaults', async (c) => {
        try {
            const defaults = await getNewSessionDefaults().get(c.get('namespace'))
            return c.json({ defaults })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to load new session defaults'
            }, 500)
        }
    })

    app.put('/settings/new-session-defaults', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = newSessionDefaultsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const defaults = await getNewSessionDefaults().replace(c.get('namespace'), parsed.data)
            return c.json({ defaults })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to save new session defaults'
            }, 500)
        }
    })

    return app
}
