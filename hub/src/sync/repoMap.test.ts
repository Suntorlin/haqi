import { describe, expect, it } from 'bun:test'
import type { ProbedRepo } from '@hapi/protocol/schemas'
import { buildRepoMap, type MachineProbe } from './repoMap'

const repo = (root: string, overrides: Partial<ProbedRepo> = {}): ProbedRepo => ({
    root,
    mainRoot: root,
    remotes: ['github.com/owner/app'],
    branch: 'main',
    head: 'aaaaaaaaaaaa',
    headTime: 0,
    changed: 0,
    untracked: 0,
    worktrees: 0,
    deps: [{ manager: 'npm', lockfile: 'package-lock.json', lockHash: 'hash-a', installed: true }],
    ...overrides
})

const machine = (machineId: string, repos: ProbedRepo[], extra: Partial<MachineProbe> = {}): MachineProbe => ({
    machineId,
    dirs: repos.map((r) => ({ dir: r.root, kind: 'repo' as const, repo: r })),
    pins: {},
    recent: [],
    ...extra
})

describe('buildRepoMap', () => {
    it('joins one repository found at different paths on two machines, and says what each needs', () => {
        const [view] = buildRepoMap([
            machine('desk', [repo('/Users/me/dev/app', { base: { behind: 0, ahead: 0 } })]),
            machine('laptop', [repo('/home/me/code/app', {
                remotes: ['github.com/me/app-fork', 'github.com/owner/app'],
                base: 'missing',
                deps: [{ manager: 'npm', lockfile: 'package-lock.json', lockHash: 'hash-b', installed: false }]
            })])
        ], { base: { repo: 'github.com/owner/app', commit: 'abcdef1' } })

        expect(view.key).toBe('github.com/owner/app')
        expect(view.machines.map((m) => m.pick?.path)).toEqual(['/Users/me/dev/app', '/home/me/code/app'])
        expect(view.machines[0].issues).toEqual([])
        expect(view.machines[1].issues.map((i) => i.code)).toEqual(['base-missing', 'deps-missing'])
    })

    it('lists a machine without the repository, so the first use there gets confirmed', () => {
        const [view] = buildRepoMap([machine('desk', [repo('/dev/app')]), machine('laptop', [])])

        expect(view.machines[1]).toMatchObject({ pick: null, checkouts: 0, issues: [{ level: 'block', code: 'repo-unknown' }] })
    })

    it('picks the main clone used last over a worktree and an older clone, and a confirmed path over both', () => {
        const probe = machine('desk', [
            repo('/dev/app'),
            repo('/dev/team/app'),
            repo('/dev/team/app-worktrees/task', { mainRoot: '/dev/team/app' })
        ], { recent: [{ path: '/dev/app', at: 1 }, { path: '/dev/team/app-worktrees/task/web', at: 2 }] })

        expect(buildRepoMap([probe])[0].machines[0]).toMatchObject({ pick: { path: '/dev/team/app', lastUsedAt: 2 }, pinned: false, checkouts: 3 })
        const pinned = buildRepoMap([{ ...probe, pins: { 'github.com/owner/app': '/dev/app' } }])
        expect(pinned[0].machines[0]).toMatchObject({ pick: { path: '/dev/app' }, pinned: true })
    })
})
