import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = import.meta.dir

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
    })
}

function imports(path: string): string[] {
    const source = readFileSync(path, 'utf8')
    return [...source.matchAll(/^\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]!)
}

describe('task architecture', () => {
    it('a plugin imports only the kernel and its own folder, never another plugin or the engine', () => {
        const pluginsDir = join(ROOT, 'plugins')
        for (const plugin of readdirSync(pluginsDir)) {
            const own = join(pluginsDir, plugin)
            for (const path of files(own)) {
                for (const target of imports(path).filter((spec) => spec.startsWith('.'))) {
                    const resolved = resolve(dirname(path), target)
                    const allowed = resolved.startsWith(own + '/') || resolved.startsWith(join(ROOT, 'kernel') + '/')
                    expect({ file: relative(ROOT, path), import: target, allowed }).toEqual({ file: relative(ROOT, path), import: target, allowed: true })
                }
            }
        }
    })

    it('the kernel does not import plugins, the task service or the engine', () => {
        for (const path of files(join(ROOT, 'kernel'))) {
            for (const target of imports(path).filter((spec) => spec.startsWith('.'))) {
                const resolved = resolve(dirname(path), target)
                expect(resolved.startsWith(join(ROOT, 'plugins')) || resolved.includes('/sync/') || resolved.endsWith('taskService')).toBe(false)
            }
        }
    })
})
