import { execFile } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { promisify } from 'node:util'

import { readSettings } from '../config/settings'

export type AlertWebhook = { url: string; secret: string | null }

const run = promisify(execFile)

/** A macOS keychain generic password, so the URL never sits in a file. */
async function fromKeychain(service: string): Promise<string | null> {
    if (process.platform !== 'darwin') return null
    try {
        const { stdout } = await run('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { timeout: 5_000 })
        return stdout.trim() || null
    } catch {
        return null
    }
}

/**
 * The Feishu/Lark bot webhook, first found of: settings.json `alertWebhook.url`, HAPI_ALERT_WEBHOOK_URL, and the
 * keychain item named by `alertWebhook.keychainService`. The secret (for a signed bot) comes from settings or
 * HAPI_ALERT_WEBHOOK_SECRET.
 */
export async function loadAlertWebhook(settingsFile: string): Promise<AlertWebhook | null> {
    const settings = await readSettings(settingsFile)
    const keychainService = settings?.alertWebhook?.keychainService?.trim()
    const url = settings?.alertWebhook?.url?.trim()
        || process.env.HAPI_ALERT_WEBHOOK_URL?.trim()
        || (keychainService ? await fromKeychain(keychainService) : null)
    if (!url || !/^https:\/\//.test(url)) return null
    const secret = settings?.alertWebhook?.secret?.trim() || process.env.HAPI_ALERT_WEBHOOK_SECRET?.trim() || null
    return { url, secret }
}

/** Lark custom bot signing: HMAC-SHA256 keyed with "timestamp\nsecret" over an empty body, base64. */
function sign(secret: string, timestamp: number): string {
    return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64')
}

/** Posts a text message to a Feishu/Lark custom bot. Throws when the bot refuses it. */
export async function sendWebhookText(webhook: AlertWebhook, text: string): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000)
    const body = {
        msg_type: 'text',
        content: { text },
        ...(webhook.secret ? { timestamp: String(timestamp), sign: sign(webhook.secret, timestamp) } : {})
    }
    const response = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
    })
    const reply = await response.json().catch(() => null) as { code?: number; StatusCode?: number; msg?: string } | null
    const code = reply?.code ?? reply?.StatusCode ?? 0
    if (!response.ok || code !== 0) throw new Error(`Webhook refused the alert: ${response.status} ${reply?.msg ?? ''}`.trim())
}
