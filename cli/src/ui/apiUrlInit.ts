/**
 * API URL initialization module
 *
 * Handles HAPI_API_URL initialization with priority:
 * 1. Environment variable (highest - allows temporary override)
 * 2. Settings file (~/.hapi/settings.json)
 * 3. Default value (http://localhost:3006)
 */

import axios from 'axios'
import { configuration } from '@/configuration'
import { readSettings } from '@/persistence'

/**
 * Initialize API URL
 * Must be called before any API operations
 */
export async function initializeApiUrl(): Promise<void> {
    const settings = await readSettings()
    installHubAccessHeaders()

    // Cloudflare Access service token: env wins over settings
    if (!process.env.HAPI_CF_ACCESS_CLIENT_ID && settings.cfAccessClientId && settings.cfAccessClientSecret) {
        configuration._setCfAccess(settings.cfAccessClientId, settings.cfAccessClientSecret)
    }

    // 1. Environment variable has highest priority (allows temporary override)
    if (process.env.HAPI_API_URL) {
        return
    }

    // 2. Read from settings file (new name first, then legacy)
    if (settings.apiUrl) {
        configuration._setApiUrl(settings.apiUrl)
        return
    }
    if (settings.serverUrl) {
        // Migrate from legacy field name
        configuration._setApiUrl(settings.serverUrl)
        return
    }

    // 3. Default value already set in configuration constructor
}

let hubAccessInterceptorInstalled = false

/**
 * Adds the Cloudflare Access headers to every axios request that goes to the hub.
 * Requests to other hosts never get the service token.
 */
function installHubAccessHeaders(): void {
    if (hubAccessInterceptorInstalled) {
        return
    }
    hubAccessInterceptorInstalled = true
    axios.interceptors.request.use((config) => {
        if (config.url?.startsWith(configuration.apiUrl)) {
            for (const [name, value] of Object.entries(configuration.hubAccessHeaders)) {
                config.headers.set(name, value)
            }
        }
        return config
    })
}
