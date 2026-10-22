/**
 * What HAQI tells the lead, the executors and the reviewer after the guide step. Every message starts with
 * WORK_MARKER so memory never reads it as the user's words.
 */
import type { AcceptanceCriterion, TaskSubtask } from '@hapi/protocol/types'

export const WORK_MARKER = '[HAQI_TASK_WORK]'

export type TaskBrief = {
    taskId: string
    goal: string
    nonGoals: string[]
    acceptance: AcceptanceCriterion[]
    repoPath: string
    /** Decisions already taken during the run (by the user or by precedent). */
    decisions?: Array<{ question: string; label: string }>
    /** What the user said in the task's conversation during the run, oldest first. */
    userMessages?: string[]
}

/** Rules every session that touches code gets: the user's hard limits. */
const HARD_RULES = [
    '不推送（git push）、不部署、不花钱、不对外发送消息、不动线上和生产目录。需要做这些时，先调用 task_decision_ask 问用户，等回答。',
    '只在你自己的目录里改。提交到你自己的分支（git commit），不要合并到主分支。'
]

function criteriaLines(acceptance: AcceptanceCriterion[], only?: string[]): string[] {
    return acceptance
        .filter((c) => !only || only.length === 0 || only.includes(c.id))
        .map((c) => `- [${c.id}] ${c.text}${c.verify ? `（验证：${c.verify}）` : ''}`)
}

function header(brief: TaskBrief, title: string): string[] {
    return [
        `${WORK_MARKER} 任务 ${brief.taskId}：${title}`,
        '',
        `## 目标\n${brief.goal}`,
        ...(brief.nonGoals.length ? ['', '## 不做什么', ...brief.nonGoals.map((line) => `- ${line}`)] : []),
        ...(brief.decisions?.length ? ['', '## 已定的决定（照做）', ...brief.decisions.map((d) => `- ${d.question} → ${d.label}`)] : []),
        ...(brief.userMessages?.length ? ['', '## 用户在任务里说过的话（照顾到）', ...brief.userMessages.map((text) => `- ${text}`)] : [])
    ]
}

export function planPrompt(brief: TaskBrief): string {
    return [
        ...header(brief, '用户确认了目标和验收标准，请拆成子任务。'),
        '',
        '## 验收标准',
        ...criteriaLines(brief.acceptance),
        '',
        '## 要做的事',
        `1. 读仓库 ${brief.repoPath} 里和这件事有关的代码，只读。读文件只用 Read、Glob、Grep，不要用 Bash，不要派子 agent。`,
        '2. 拆成 1–5 个子任务。每个子任务交给一个执行会话，在它自己的 git worktree 里独立完成。能一个会话做完就只拆 1 个；会改同一批文件的不要拆开。',
        '3. 每个子任务写：id（英文短词）、title（不超过 20 字）、brief（要改什么、在哪里改、怎么验证；执行会话只看得到这段）、criteria（它负责的验收标准 id）、depends_on（必须先做完的子任务 id）。所有验收标准都要有子任务负责。',
        `4. 调用 task_plan_submit 提交，task_id 填 "${brief.taskId}"。工具报错就按报错改了再交。`,
        '5. 提交后停下。你不用自己改代码。'
    ].join('\n')
}

export function workPrompt(brief: TaskBrief, subtask: TaskSubtask): string {
    return [
        ...header(brief, `你负责子任务「${subtask.title}」。`),
        '',
        '## 你的子任务',
        subtask.brief,
        '',
        '## 你负责的验收标准',
        ...criteriaLines(brief.acceptance, subtask.criteria),
        '',
        '## 规则',
        ...HARD_RULES.map((rule) => `- ${rule}`),
        '- 遇到要用户拍板的事（方案分歧、超出范围、验收标准说不清），调用 task_decision_ask，给 2–4 个选项、每个选项的好处和代价、你的建议。然后先做不依赖这个决定的部分；回答会发到这个会话。',
        '',
        '## 做完以后',
        '1. 按“验证”一栏自己验证，跑相关的测试。',
        '2. git commit 到你的分支。',
        `3. 调用 subtask_done：task_id 填 "${brief.taskId}"，subtask_id 填 "${subtask.id}"，summary 写改了什么、怎么验证的，evidence 每条写一个证据（命令和结果、文件和行、截图路径）。`
    ].join('\n')
}

export function integratePrompt(brief: TaskBrief, done: TaskSubtask[], target: { branch: string; worktree: string }): string {
    return [
        ...header(brief, '子任务都做完了，请把它们合并到一个分支。'),
        '',
        '## 子任务和分支',
        ...done.map((s) => `- ${s.title}：分支 ${s.branch ?? '（未知）'}。${s.summary ?? ''}`),
        '',
        '## 要做的事',
        `1. 在仓库 ${brief.repoPath} 新建一个 worktree：git -C ${brief.repoPath} worktree add ${target.worktree} -b ${target.branch}（从当前主分支）。不要在仓库主目录切分支或改文件。`,
        `2. 在 ${target.worktree} 里依次 git merge 上面的分支。冲突能确定的就解决；拿不准的调用 task_decision_ask 问用户。`,
        '3. 跑项目的测试。',
        `4. 调用 task_integrated：task_id 填 "${brief.taskId}"，branch 填 "${target.branch}"，worktree_path 填 "${target.worktree}"，summary 写合并结果和测试结果。`,
        '',
        '## 规则',
        ...HARD_RULES.map((rule) => `- ${rule}`)
    ].join('\n')
}

export function reviewPrompt(brief: TaskBrief, evidence: string[], round: number): string {
    return [
        ...header(brief, `请按验收标准评审（第 ${round} 轮）。`),
        '',
        '## 验收标准（只有这些能判“没达到”）',
        ...criteriaLines(brief.acceptance),
        '',
        '## 执行者交的材料',
        ...evidence.map((line) => `- ${line}`),
        '',
        '## 要做的事',
        '1. 你在合并好的分支目录里。逐条自己验证：跑“验证”一栏的命令、读代码。不要只信执行者的说法。',
        '2. 不要改任何文件，不要提交。',
        '3. 每条给结论：met（达到）、not_met（没达到）、unclear（说不清），evidence 写你看到的证据。',
        '4. 你自己想到的、验收标准里没有的问题，写进 suggestions，不能因此判 not_met。',
        ...(brief.userMessages?.some((line) => line.startsWith('验收时要改：'))
            ? ['5. 上面「验收时要改」的每一条，也检查做到没有。每条写一句进 suggestions，以「用户要改：」开头，说做到没有、证据在哪。']
            : []),
        `${brief.userMessages?.some((line) => line.startsWith('验收时要改：')) ? 6 : 5}. 调用 task_review_submit：task_id 填 "${brief.taskId}"。`
    ].join('\n')
}

export function fixPrompt(brief: TaskBrief, items: string[], worktree: string, subtaskId: string): string {
    return [
        ...header(brief, '有几条验收标准还没达到，请改好。'),
        '',
        '## 要改的',
        ...items.map((line) => `- ${line}`),
        '',
        '## 规则',
        `- 你在合并好的分支目录 ${worktree} 里，直接在这里改，改完 git commit。`,
        ...HARD_RULES.slice(0, 1).map((rule) => `- ${rule}`),
        '',
        `做完调用 subtask_done：task_id 填 "${brief.taskId}"，subtask_id 填 "${subtaskId}"，summary 写改了什么、怎么验证的。`
    ].join('\n')
}

export function remindPrompt(taskId: string, subtask: TaskSubtask): string {
    return [
        `${WORK_MARKER} 任务 ${taskId}：你还在做子任务「${subtask.title}」吗？`,
        `做完了请调用 subtask_done（subtask_id 填 "${subtask.id}"）。卡住了请调用 task_decision_ask，说清卡在哪、有哪些办法。`
    ].join('\n')
}

export function userMessagePrompt(taskId: string, text: string): string {
    return `${WORK_MARKER} 任务 ${taskId}：用户在任务里说：「${text}」。和你的工作有关就照顾到，然后继续；不用回复。`
}

export function answerPrompt(taskId: string, question: string, label: string, by: 'user' | 'precedent'): string {
    return `${WORK_MARKER} 任务 ${taskId}：「${question}」${by === 'user' ? '用户选了' : '按用户以前的同类选择'}：${label}。按这个继续。`
}
