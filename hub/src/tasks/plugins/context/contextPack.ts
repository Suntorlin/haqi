/**
 * The user-model reader: what the planner should know about the user before it drafts acceptance criteria. It reads
 * through the sources it is given and returns plain text with an id on every item, so the draft can cite them.
 */

export type ContextSources = {
    /** The session the task was created from: its name and the user's last messages there. */
    currentSession: (sessionId: string) => { name: string | null; userMessages: string[] } | null
    /** Recent tasks with the same tag. */
    relatedTasks: (tag: string, excludeId: string) => Array<{ id: string; name: string; goal: string | null; acceptance: string[] }>
    /** Active principles: every global one, plus those for this repository or with this tag. */
    principles: (project: string | null, tag: string) => Array<{ id: string; text: string; scope: string }>
    /** Active experiences close in meaning to what the user asked for. */
    experiences: (query: string, project: string | null) => Promise<Array<{ id: string; text: string }>>
}

export type ContextInput = {
    taskId: string
    text: string
    tag: string
    project: string | null
    repoPath: string | null
    fromSessionId: string | null
}

export type ContextPack = {
    text: string
    principleIds: string[]
    experienceIds: string[]
}

export const CONTEXT_LIMITS = { userMessages: 5, relatedTasks: 5, experiences: 8, messageChars: 300 } as const

function cut(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export async function buildContextPack(input: ContextInput, sources: ContextSources): Promise<ContextPack> {
    const sections: string[] = []

    const session = input.fromSessionId ? sources.currentSession(input.fromSessionId) : null
    if (session) {
        const messages = session.userMessages.slice(-CONTEXT_LIMITS.userMessages).map((m) => `- ${cut(m, CONTEXT_LIMITS.messageChars)}`)
        sections.push([`## 当前会话：${session.name ?? '（未命名）'}`, messages.length ? '你最近说的话：' : '（没有你的消息）', ...messages].join('\n'))
    }

    sections.push(`## 仓库\n${input.repoPath ? `目录：${input.repoPath}${input.project ? `（项目 ${input.project}）` : ''}。约定文件（AGENTS.md、CLAUDE.md、HARNESS.md 等）请自己读。` : '没有仓库目录。'}`)

    const related = sources.relatedTasks(input.tag, input.taskId).slice(0, CONTEXT_LIMITS.relatedTasks)
    if (related.length) {
        sections.push(['## 同 tag 的近期任务', ...related.map((task) => [
            `- [task:${task.id}] ${task.name}${task.goal ? `：${task.goal}` : ''}`,
            ...task.acceptance.map((line) => `  - 验收：${line}`)
        ].join('\n'))].join('\n'))
    }

    const principles = sources.principles(input.project, input.tag)
    sections.push(principles.length
        ? ['## 你的原则（必须遵守）', ...principles.map((p) => `- [${p.id}] ${p.text}${p.scope ? `（${p.scope}）` : ''}`)].join('\n')
        : '## 你的原则\n（没有）')

    const experiences = (await sources.experiences(input.text, input.project)).slice(0, CONTEXT_LIMITS.experiences)
    sections.push(experiences.length
        ? ['## 相关经验（你以前的选择和教训）', ...experiences.map((e) => `- [${e.id}] ${e.text}`)].join('\n')
        : '## 相关经验\n（没有）')

    return {
        text: sections.join('\n\n'),
        principleIds: principles.map((p) => p.id),
        experienceIds: experiences.map((e) => e.id)
    }
}
