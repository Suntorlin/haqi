import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeRemote, probeMachine } from './probe'

const run = promisify(execFile)
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd }).then((r) => r.stdout.trim())

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })

async function makeRepo(path: string): Promise<string> {
    await mkdir(path, { recursive: true })
    await git(path, 'init', '-q', '-b', 'main')
    await git(path, 'config', 'user.email', 'test@example.com')
    await git(path, 'config', 'user.name', 'Test')
    await git(path, 'remote', 'add', 'origin', 'git@github.com:Owner/App.git')
    await writeFile(join(path, 'package-lock.json'), '{}')
    await git(path, 'add', '.')
    await git(path, 'commit', '-q', '-m', 'first')
    return git(path, 'rev-parse', 'HEAD')
}

describe('normalizeRemote', () => {
    it('gives ssh, https and ssh-with-port URLs of one repository the same name', () => {
        expect(normalizeRemote('git@github.com:Owner/App.git')).toBe('github.com/owner/app')
        expect(normalizeRemote('https://github.com/Owner/App')).toBe('github.com/owner/app')
        expect(normalizeRemote('ssh://git@github.com:22/Owner/App.git')).toBe('github.com/owner/app')
    })
})

describe('probeMachine', () => {
    it('reads a folder of checkouts, ties a worktree to its main clone and measures against a base', async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), 'probe-')))
        const app = join(root, 'app')
        const first = await makeRepo(app)
        await git(app, 'worktree', 'add', '-q', join(root, 'app-task'), '-b', 'task')
        await writeFile(join(app, 'new.txt'), 'x')

        const { dirs } = await probeMachine({ dirs: [root, join(root, 'app-task'), join(root, 'gone')], base: first })

        const [folder, worktree, gone] = dirs
        expect(folder.kind === 'folder' && folder.repos.map((r) => r.root).sort()).toEqual([app, join(root, 'app-task')])
        expect(gone.kind).toBe('missing')
        if (worktree.kind !== 'repo') throw new Error('expected a checkout')
        expect(worktree.repo).toMatchObject({
            root: join(root, 'app-task'),
            mainRoot: app,
            remotes: ['github.com/owner/app'],
            branch: 'task',
            worktrees: 1,
            base: { behind: 0, ahead: 0 },
            deps: [{ manager: 'npm', lockfile: 'package-lock.json', installed: false }]
        })
        const main = folder.kind === 'folder' ? folder.repos.find((r) => r.root === app) : null
        expect(main).toMatchObject({ root: app, mainRoot: app, untracked: 1 })
    })

    it('marks a base commit the checkout does not have', async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), 'probe-')))
        await makeRepo(join(root, 'app'))

        const { dirs } = await probeMachine({ dirs: [join(root, 'app')], base: 'abcdef1234567' })

        expect(dirs[0].kind === 'repo' && dirs[0].repo.base).toBe('missing')
    })
})
