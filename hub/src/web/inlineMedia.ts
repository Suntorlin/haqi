// Screenshots and files an agent reads come back inside tool results as base64 blocks
// ({ type: 'base64', media_type, data }). One block can be 600 KB, and the web app never
// draws them, so the hub sends the block without its bytes. The stored message keeps them.

const MIN_OMITTED_LENGTH = 1024
const MAX_DEPTH = 24

export function omitInlineMedia<T>(value: T): T {
    return walk(value, 0) as T
}

function walk(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
        return value
    }

    if (Array.isArray(value)) {
        let next: unknown[] | null = null
        for (let index = 0; index < value.length; index += 1) {
            const item = value[index]
            const walked = walk(item, depth + 1)
            if (walked !== item) {
                next ??= value.slice()
                next[index] = walked
            }
        }
        return next ?? value
    }

    const record = value as Record<string, unknown>
    if (record.type === 'base64' && typeof record.data === 'string' && record.data.length >= MIN_OMITTED_LENGTH) {
        return { ...record, data: '', omittedBytes: Math.floor(record.data.length * 3 / 4) }
    }

    let next: Record<string, unknown> | null = null
    for (const key of Object.keys(record)) {
        const item = record[key]
        const walked = walk(item, depth + 1)
        if (walked !== item) {
            next ??= { ...record }
            next[key] = walked
        }
    }
    return next ?? record
}
