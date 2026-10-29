/**
 * JSON calls from the CLI to the hub's web API, authenticated with the CLI token exchanged for a short web JWT.
 * Shared by the MCP tool server and the employee compaction pilot.
 */

import { configuration } from "@/configuration";
import { getAuthToken } from "@/api/auth";

type JsonObject = Record<string, unknown>;

let cachedWebToken: { token: string; expiresAt: number } | null = null;

export function resolveHubUrl(path: string): string {
    const normalizedBase = configuration.apiUrl.endsWith("/")
        ? configuration.apiUrl
        : `${configuration.apiUrl}/`;
    return new URL(path, normalizedBase).toString();
}

async function getWebToken(): Promise<string> {
    if (cachedWebToken && cachedWebToken.expiresAt > Date.now()) {
        return cachedWebToken.token;
    }

    const response = await fetch(resolveHubUrl("/api/auth"), {
        method: "POST",
        headers: {
            ...configuration.hubAccessHeaders,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ accessToken: getAuthToken() })
    });

    const payload = await response.json().catch(() => null) as JsonObject | null;
    if (!response.ok) {
        const message = typeof payload?.error === "string"
            ? payload.error
            : `Auth failed (${response.status})`;
        throw new Error(message);
    }

    const token = typeof payload?.token === "string" ? payload.token : "";
    if (!token) {
        throw new Error("Auth succeeded but token is missing");
    }

    cachedWebToken = {
        token,
        expiresAt: Date.now() + 13 * 60 * 1000
    };
    return token;
}

export async function requestHubJson(path: string, init?: RequestInit): Promise<JsonObject> {
    const doRequest = async (token: string): Promise<Response> => {
        const headers = new Headers(init?.headers);
        for (const [name, value] of Object.entries(configuration.hubAccessHeaders)) {
            headers.set(name, value);
        }
        headers.set("Authorization", `Bearer ${token}`);
        if (init?.body !== undefined && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        return await fetch(resolveHubUrl(path), {
            ...init,
            headers
        });
    };

    let response = await doRequest(await getWebToken());
    if (response.status === 401) {
        cachedWebToken = null;
        response = await doRequest(await getWebToken());
    }

    const payload = await response.json().catch(() => null) as JsonObject | null;
    if (!response.ok) {
        const message = typeof payload?.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
    }

    return payload ?? {};
}
