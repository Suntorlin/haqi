/**
 * The planner: one resident session per task that reads the context pack and the repository, drafts the goal and the
 * acceptance criteria, and hands them back through the task_draft_submit tool. It does not change code.
 */

import type { TaskDraft } from '../../kernel/draft'
import { DRAFT_LIMITS } from '../../kernel/draft'

/** Every message HAQI sends to a planner starts with this, so memory never reads it as the user's words. */
export const GUIDE_MARKER = '[HAQI_TASK_GUIDE]'

export type PlannerHost = {
    /** Starts a session in `directory` on `machineId` and sends it the first message; null on success. */
    spawnAndPrompt: (input: { machineId: string; directory: string; name: string; tags: string[]; text: string; meta: Record<string, unknown> }) => Promise<{ sessionId: string } | { error: string }>
    /** Sends one more message to a running session; false when the session is not running. */
    send: (sessionId: string, text: string, meta: Record<string, unknown>) => Promise<boolean>
}

export type GuideRequest = {
    taskId: string
    taskName: string
    tag: string
    text: string
    machineId: string
    repoPath: string
    contextText: string
    /** Set when the first planner stopped: the draft so far and what the user wants changed. */
    resume?: { draft: TaskDraft | null; feedback: string }
}

function meta(taskId: string, step: string): Record<string, unknown> {
    return { taskGuide: { taskId, step } }
}

export function guidePrompt(request: GuideRequest): string {
    const lines = [
        `${GUIDE_MARKER} 任务 ${request.taskId}：帮用户把需求写成目标和验收标准。用户不爱写验收标准：你起草，用户只勾选和点选。`,
        '',
        '## 用户的需求',
        request.text,
        '',
        '## 你知道的用户（上下文包）',
        request.contextText,
        '',
        '## 要做的事',
        '1. 读上下文包，再读仓库根目录的约定文件（AGENTS.md、CLAUDE.md、HARNESS.md，有哪个读哪个）。只读，不改任何文件，不跑会改东西的命令。',
        `2. 写一句目标（不超过 ${DRAFT_LIMITS.goal} 字），和最多 ${DRAFT_LIMITS.nonGoals} 条“不做什么”。`,
        `3. 写 ${DRAFT_LIMITS.criteriaMin}–${DRAFT_LIMITS.criteriaMax} 条验收标准。每条要能验证，写清怎么验证（命令、页面、数据）。`,
        '   每条标出处：source=principle 时 source_ref 填原则的 id；source=repo 时填约定文件名；只有你自己推断的才用 inferred。',
        `4. 只问上下文包和仓库里确定不了的事，最多 ${DRAFT_LIMITS.questions} 个选择题，每题 ${DRAFT_LIMITS.optionsMin}–${DRAFT_LIMITS.optionsMax} 个选项，给一个默认选项。默认选项有先例时，precedent_ref 填那条经验的 id。能确定的就不要问。`,
        `5. 调用 task_draft_submit 提交，task_id 填 "${request.taskId}"。工具报错就按报错改了再交。`,
        '6. 提交后停下，等用户确认或要你修改。不要开始实现。',
        '',
        '用中文写，句子短，一句话只说一件事。'
    ]
    if (request.resume) {
        lines.push('', '## 接着上一版改', '上一个规划会话停了。这是它交的最后一版草稿和用户的修改意见。')
        if (request.resume.draft) lines.push('```json', JSON.stringify(request.resume.draft, null, 2), '```')
        lines.push(`用户的意见：${request.resume.feedback}`)
    }
    return lines.join('\n')
}

export function revisePrompt(taskId: string, feedback: string): string {
    return [
        `${GUIDE_MARKER} 任务 ${taskId}：用户要你改草稿。`,
        `用户的意见：${feedback}`,
        `改完再调用 task_draft_submit（task_id 填 "${taskId}"）提交新的一版。还是只读，不改代码。`
    ].join('\n')
}

export function confirmedPrompt(taskId: string, acceptance: string[]): string {
    return [
        `${GUIDE_MARKER} 任务 ${taskId}：用户已确认目标和验收标准。`,
        ...acceptance.map((line, index) => `${index + 1}. ${line}`),
        '你留在这个任务里当负责人。现在不要开始实现，等后续指令。'
    ].join('\n')
}

export class Planner {
    constructor(private readonly host: PlannerHost) {}

    async start(request: GuideRequest): Promise<{ sessionId: string } | { error: string }> {
        return await this.host.spawnAndPrompt({
            machineId: request.machineId,
            directory: request.repoPath,
            name: `规划 · ${request.taskName}`,
            tags: [request.tag],
            text: guidePrompt(request),
            meta: meta(request.taskId, request.resume ? 'restart' : 'start')
        })
    }

    async revise(sessionId: string, taskId: string, feedback: string): Promise<boolean> {
        return await this.host.send(sessionId, revisePrompt(taskId, feedback), meta(taskId, 'revise'))
    }

    async confirmed(sessionId: string, taskId: string, acceptance: string[]): Promise<boolean> {
        return await this.host.send(sessionId, confirmedPrompt(taskId, acceptance), meta(taskId, 'confirmed'))
    }
}
