import { z } from 'zod'

/**
 * Inbound channels: outside systems that wake a digital employee. Every channel goes through the same pipeline —
 * normalize the request into one InboundMessage, then EmployeeService.inbound() fences the content as untrusted,
 * wakes the employee with the inbound taint and writes the run log. The webhook is the first implementation; a
 * later Lark (飞书) channel implements the same interface, adds its own signature check in parse(), and registers
 * itself in INBOUND_CHANNELS — the hook route and the safety handling stay unchanged.
 */
export type InboundMessage = {
    channel: string
    sender: string | null
    text: string
}

export interface InboundChannel {
    readonly kind: string
    /** Normalizes a request body into one message, or says what is wrong with it (the route answers 400). */
    parse(body: unknown): InboundMessage | { error: string }
}

const webhookBodySchema = z.object({
    text: z.string().trim().min(1).max(20_000),
    sender: z.string().trim().min(1).max(200).optional()
})

/** `POST /hooks/inbound/webhook/<slug>` with `{"text": "...", "sender": "..."}`; the slug is the secret. */
export class WebhookChannel implements InboundChannel {
    readonly kind = 'webhook'

    parse(body: unknown): InboundMessage | { error: string } {
        const parsed = webhookBodySchema.safeParse(body)
        if (!parsed.success) return { error: 'Invalid body: text (1-20000 chars) is required, sender is optional' }
        return { channel: this.kind, sender: parsed.data.sender ?? null, text: parsed.data.text }
    }
}

export const INBOUND_CHANNELS: Record<string, InboundChannel> = {
    webhook: new WebhookChannel()
}
