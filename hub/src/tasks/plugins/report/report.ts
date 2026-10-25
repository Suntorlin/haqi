/**
 * The report: the task compressed for the user, in a fixed order so the first two parts are enough to decide —
 * conclusion (and what changed, when the user asked for a change), what the user has to do; then, folded, what HAQI checked
 * (each criterion with evidence, numbers, risks, decisions taken by precedent) and the process; and one line on how often the user had to step in.
 */
import type { AcceptanceCriterion, TaskLoad, TaskRun } from '@hapi/protocol/types'

export type ReportInput = {
    name: string
    goal: string
    acceptance: AcceptanceCriterion[]
    run: TaskRun
    load: TaskLoad | null
    startedAt: number
    now: number
}

const VERDICT_LABEL = { met: '达到', not_met: '没达到', unclear: '说不清' } as const

function duration(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / 60_000))
    return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

export function composeReport(input: ReportInput): { conclusion: string; markdown: string } {
    const { run } = input
    const results = run.review?.results ?? []
    const byId = new Map(results.map((r) => [r.criterionId, r]))
    const met = results.filter((r) => r.status === 'met').length
    const failed = input.acceptance.filter((c) => byId.get(c.id)?.status !== 'met')
    const branch = run.integration?.branch ?? null
    // The lead's hand-over is what the user reads; it counts only if it is newer than the user's last change request.
    const lastRevision = run.revisions?.at(-1) ?? null
    const delivery = run.delivery && (!lastRevision || run.delivery.at > lastRevision.at) ? run.delivery : null
    // Without one, the user's last change request leads the report: it is what they wait to see.
    const revision = !delivery && lastRevision?.summary ? lastRevision : null
    const criteria = failed.length === 0
        ? `${input.acceptance.length} 条验收标准全部达到${branch ? `，结果在本地分支 ${branch}（未推送）` : ''}。`
        : `${input.acceptance.length} 条验收标准达到 ${met} 条，${failed.length} 条没达到或说不清。`
    const conclusion = delivery?.conclusion || (revision ? `按你的意见改好了；${criteria}` : criteria)

    const userDecisions = run.decisions.filter((d) => d.answer?.by === 'user')
    const precedents = run.decisions.filter((d) => d.answer?.by === 'precedent')
    const open = run.decisions.filter((d) => !d.answer)
    const todo = [
        branch ? `看一下分支 ${branch}，决定要不要合进主分支（HAQI 不推送、不合并）。` : null,
        ...failed.slice(0, 2).map((c) => `「${c.text}」${byId.get(c.id) ? VERDICT_LABEL[byId.get(c.id)!.status] : '没评审'}：要不要接受？`),
        ...open.slice(0, 1).map((d) => `还没回答：${d.question}`)
    ].filter((line): line is string => Boolean(line)).slice(0, 3)

    const risks = [
        ...failed.map((c) => `「${c.text}」：${byId.get(c.id)?.evidence ?? '评审没给结论'}`),
        ...run.signals.filter((s) => s.kind !== 'reminded' && s.kind !== 'approval').map((s) => s.text)
    ]
    const workers = run.subtasks.filter((s) => !s.fix)
    const fixes = run.subtasks.filter((s) => s.fix && s.id.startsWith('fix-'))
    const notified = run.signals.filter((s) => s.notified).length
    const load = input.load
    const loadLine = load
        ? `你开口 ${load.progress + load.correction + load.decision + load.request} 次：拍板 ${load.decision}、纠正 ${load.correction}、追问 ${load.progress}、新要求 ${load.request}；HAQI 推送提醒 ${notified} 次，请你拍板 ${userDecisions.length + open.length} 次。`
        : `HAQI 推送提醒 ${notified} 次，请你拍板 ${userDecisions.length + open.length} 次。`

    const checked = `HAQI 的核对：验收 ${met}/${input.acceptance.length} 达到${fixes.length ? `，返工 ${fixes.length} 次` : ''}${risks.length ? `，风险 ${risks.length} 条` : ''}`

    const lines = [
        `# ${input.name}`,
        '',
        `**${conclusion}**`,
        '',
        ...(delivery ? [delivery.body, ''] : [
            `目标：${input.goal}`,
            '',
            ...(revision ? ['## 按你的意见改了', `你说：「${revision.request}」`, '', revision.summary!, ''] : []),
            '## 要你做的事',
            ...(todo.length ? todo.map((line, i) => `${i + 1}. ${line}`) : ['没有。']),
            ''
        ]),
        // What HAQI checked backs the hand-over up; it stays folded so the user reads only the hand-over.
        `<details><summary>${checked}</summary>`,
        '',
        '## 验收标准',
        '| # | 标准 | 结论 | 证据 |',
        '|---|---|---|---|',
        ...input.acceptance.map((c, i) => {
            const r = byId.get(c.id)
            return `| ${i + 1} | ${c.text} | ${r ? VERDICT_LABEL[r.status] : '没评审'} | ${(r?.evidence ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`
        }),
        '',
        '## 关键数字',
        `- 用时 ${duration(input.now - input.startedAt)}；子任务 ${workers.length} 个${fixes.length ? `，返工 ${fixes.length} 次` : ''}；评审 ${run.review?.round ?? 0} 轮。`,
        `- 中途决策 ${run.decisions.length} 个：你拍板 ${userDecisions.length}，按先例 ${precedents.length}${open.length ? `，未回答 ${open.length}` : ''}。`,
        ...(branch ? [`- 结果：本地分支 \`${branch}\`，目录 \`${run.integration!.worktree}\`。`] : []),
        '',
        '## 风险和不一致',
        ...(risks.length ? risks.map((line) => `- ${line}`) : ['- 没有。']),
        '',
        '## 按先例做的决定（可以推翻）',
        ...(precedents.length ? precedents.map((d) => `- ${d.question} → ${d.answer!.label}（经验 ${d.answer!.memoryId ?? ''}）`) : ['- 没有。']),
        ...(userDecisions.length ? ['', '## 你拍板的', ...userDecisions.map((d) => `- ${d.question} → ${d.answer!.label}`)] : []),
        ...(run.review?.suggestions.length ? ['', '## 评审的建议（不影响验收）', ...run.review.suggestions.map((line) => `- ${line}`)] : []),
        '',
        '</details>',
        '',
        '<details><summary>过程</summary>',
        '',
        ...run.subtasks.filter((s) => !s.id.startsWith('deliver-')).map((s) => `- **${s.fix && s.id.startsWith('fix-') ? '返工 · ' : ''}${s.title}**${s.branch ? `（${s.branch}）` : ''}：${s.summary ?? '没交总结'}`),
        ...(run.integration?.summary ? [`- **合并**：${run.integration.summary}`] : []),
        '',
        '</details>',
        '',
        `> ${loadLine}`
    ]
    return { conclusion, markdown: lines.join('\n') }
}
