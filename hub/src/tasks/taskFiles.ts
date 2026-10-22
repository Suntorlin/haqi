import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { TaskFile } from '@hapi/protocol/types'

/** A file as the web sends it and as a session upload takes it: the bytes in base64. */
export type TaskFileContent = { filename: string; mimeType: string; content: string }

type Entry = TaskFile & { file: string }

export const TASK_FILE_LIMITS = { count: 8, bytes: 10 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 } as const

const MANIFEST = 'files.json'

/**
 * The files the user attached when creating a task. They live on the hub, not on a machine: a planner or executor
 * session deletes its uploads when it ends, so every session the task starts gets its own copy.
 */
export class TaskFiles {
    private readonly cache = new Map<string, Entry[]>()

    /** `root` is read on use: the hub's data directory is known only after start-up. */
    constructor(private readonly root: () => string) {}

    save(taskId: string, files: TaskFileContent[]): TaskFile[] {
        if (files.length === 0) return []
        const dir = this.dir(taskId)
        mkdirSync(dir, { recursive: true })
        const entries = files.map((file, index): Entry => {
            const bytes = Buffer.from(file.content, 'base64')
            const name = file.filename.trim() || 'file'
            const stored = `${index}-${safeName(name)}`
            writeFileSync(join(dir, stored), bytes)
            return { name, mimeType: file.mimeType || 'application/octet-stream', size: bytes.length, file: stored }
        })
        writeFileSync(join(dir, MANIFEST), JSON.stringify(entries))
        this.cache.set(taskId, entries)
        return entries.map(publicEntry)
    }

    list(taskId: string): TaskFile[] {
        return this.entries(taskId).map(publicEntry)
    }

    read(taskId: string, index: number): TaskFileContent | null {
        const entry = this.entries(taskId)[index]
        if (!entry) return null
        const path = join(this.dir(taskId), entry.file)
        if (!existsSync(path)) return null
        return { filename: entry.name, mimeType: entry.mimeType, content: readFileSync(path).toString('base64') }
    }

    readAll(taskId: string): TaskFileContent[] {
        return this.entries(taskId).map((_entry, index) => this.read(taskId, index)).filter((file): file is TaskFileContent => file !== null)
    }

    remove(taskId: string): void {
        this.cache.delete(taskId)
        rmSync(this.dir(taskId), { recursive: true, force: true })
    }

    private entries(taskId: string): Entry[] {
        const cached = this.cache.get(taskId)
        if (cached) return cached
        let entries: Entry[] = []
        try {
            const path = join(this.dir(taskId), MANIFEST)
            if (existsSync(path)) entries = JSON.parse(readFileSync(path, 'utf8')) as Entry[]
        } catch {
            entries = []
        }
        this.cache.set(taskId, entries)
        return entries
    }

    private dir(taskId: string): string {
        return join(this.root(), safeName(taskId))
    }
}

function publicEntry(entry: Entry): TaskFile {
    return { name: entry.name, mimeType: entry.mimeType, size: entry.size }
}

function safeName(name: string): string {
    return name.replace(/[/\\]/g, '_').replace(/\.\./g, '_').replace(/\s+/g, '_').slice(0, 120) || 'file'
}
