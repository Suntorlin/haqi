/**
 * Memory page prototype data. One memory = one sentence + level + scope.
 *  - level: how settled it is (fact -> experience -> principle)
 *  - scope: where it applies (everywhere, or one project)
 * Jev numbers mirror the 10-14 offline evals where one existed.
 */

export type Level = 'fact' | 'experience' | 'principle'
export type Status = 'active' | 'pending'

export const LEVEL_LABEL: Record<Level, string> = { fact: '事实', experience: '经验', principle: '原则' }
export const GLOBAL_SCOPE = '全局'

export type JevVerdict = {
    keep: number
    level: { choice: Level; confidence: number }
    scope: { choice: string; confidence: number }
}

export type Memory = {
    id: string
    text: string
    level: Level
    scope: string
    status: Status
    /** Why it waits for you (pending only). */
    reason?: string
    /** Who wrote it and from where. */
    source: string
    at: string
    jev?: JevVerdict
    /** Levels / scope you changed after Jev decided. */
    overridden?: { level?: Level; scope?: string }
    /** Memories one level down that back this one. */
    evidence?: string[]
    /** A pending memory that would replace this one. */
    replaces?: string
    versions?: number
}

export const MEMORIES: Memory[] = [
    // 原则
    { id: 'g1', text: '回复用中文，结论先行，不复述过程。', level: 'principle', scope: GLOBAL_SCOPE, status: 'active', source: '你说的', at: '10-02', evidence: ['f1'], versions: 3 },
    { id: 'g2', text: '没有你明确说“推送”，不 push 到远程分支。', level: 'principle', scope: GLOBAL_SCOPE, status: 'active', source: '你说的', at: '10-03', versions: 4 },
    { id: 'g3', text: '给你看的东西只给公网链接，发出前确认能打开。', level: 'principle', scope: GLOBAL_SCOPE, status: 'active', source: '由 2 条事实归纳 · 你确认', at: '10-06', evidence: ['f2', 'f3'], versions: 2 },
    { id: 'g4', text: '能自己验证的直接做完再汇报；花钱、对外发送、动生产才先问。', level: 'principle', scope: GLOBAL_SCOPE, status: 'active', source: '你说的', at: '10-03' },
    { id: 'g5', text: '截图和录屏放 Linear 工单，笔记里只放链接。', level: 'principle', scope: GLOBAL_SCOPE, status: 'active', source: '你说的', at: '10-05' },
    { id: 'h1', text: '发正式站前先备份 dist，出问题直接拷回去。', level: 'principle', scope: 'haqi', status: 'active', source: '由经验升级 · 你确认', at: '10-09', evidence: ['e1'], versions: 2 },
    { id: 'h2', text: '测试不写真实数据：拦截所有非 GET 请求。', level: 'principle', scope: 'haqi', status: 'active', source: '你说的', at: '10-07' },
    { id: 'h3', text: '记忆按三级成熟：事实 → 经验 → 原则；原则要你确认才生效。', level: 'principle', scope: 'haqi', status: 'active', source: '你的消息 · HAQI 记忆页设计', at: '9 分钟前',
        jev: { keep: 0.47, level: { choice: 'fact', confidence: 0.3 }, scope: { choice: 'haqi', confidence: 0.21 } }, overridden: { level: 'principle' } },

    // 经验
    { id: 'e1', text: '部署 web 时 sw.js、index.html 放到最后拷，避免刷新到半新半旧的页面。', level: 'experience', scope: 'haqi', status: 'active', source: '由 2 条事实归纳', at: '10-13', evidence: ['hf1', 'hf2'], versions: 2,
        jev: { keep: 0.9, level: { choice: 'experience', confidence: 0.66 }, scope: { choice: 'haqi', confidence: 0.93 } } },
    { id: 'e2', text: '测“运行中”状态先断开 /api/events，否则心跳会冲掉伪造的状态。', level: 'experience', scope: 'haqi', status: 'active', source: '由 2 条事实归纳', at: '10-13', evidence: ['hf3', 'hf4'] },
    { id: 'e3', text: '改了 CLI 要重启受影响的会话再验证。', level: 'experience', scope: 'haqi', status: 'active', source: '会话 · HAQI 账号切换', at: '10-11', evidence: ['hf5'] },
    { id: 'e7', text: 'Playwright 截图把 token 种进 localStorage，别放进 URL。', level: 'experience', scope: 'haqi', status: 'active', source: '会话 · HAQI 记忆页设计', at: '2 分钟前',
        jev: { keep: 0.81, level: { choice: 'experience', confidence: 0.77 }, scope: { choice: 'haqi', confidence: 0.74 } } },
    { id: 'e4', text: '等待类任务要挂后台监控，别以“好了再…”结尾。', level: 'experience', scope: GLOBAL_SCOPE, status: 'active', source: '由 2 条事实归纳', at: '10-09', evidence: ['f4', 'f5'] },
    { id: 'e6', text: 'Jev 比较两条规则是否冲突不准，合并改写交给大模型。', level: 'experience', scope: 'agent-engine', status: 'active', source: '会话 · HAQI 记忆设计', at: '10-14' },

    // 事实
    { id: 'f1', text: '10-13 02:10 你在手机上说回复太长。', level: 'fact', scope: GLOBAL_SCOPE, status: 'active', source: '你的消息', at: '10-13' },
    { id: 'f2', text: '10-02 你要求把报告链接换成公网地址。', level: 'fact', scope: GLOBAL_SCOPE, status: 'active', source: '你的消息', at: '10-02' },
    { id: 'f3', text: '10-06 你说在外面打不开 localhost。', level: 'fact', scope: GLOBAL_SCOPE, status: 'active', source: '你的消息', at: '10-06' },
    { id: 'f4', text: '10-09 你两次追问“好了没”，当时后台任务没挂监控。', level: 'fact', scope: GLOBAL_SCOPE, status: 'active', source: '你的消息', at: '10-09' },
    { id: 'f5', text: '10-13 任务跑了 25 分钟没汇报，你又追问一次。', level: 'fact', scope: GLOBAL_SCOPE, status: 'active', source: '你的消息', at: '10-13' },
    { id: 'hf1', text: '10-13 先拷 sw.js，页面白屏 3 分钟，已回滚。', level: 'fact', scope: 'haqi', status: 'active', source: '会话 · HAQI 社交改版', at: '10-13' },
    { id: 'hf2', text: '10-08 index.html 先更新，刷新后拿到旧 js 报错。', level: 'fact', scope: 'haqi', status: 'active', source: '会话 · HAQI main 部署', at: '10-08' },
    { id: 'hf3', text: '10-13 SSE 心跳把伪造的 thinking 改回 false。', level: 'fact', scope: 'haqi', status: 'active', source: '会话 · HAQI 社交改版', at: '10-13' },
    { id: 'hf4', text: '10-13 断开 /api/events 后运行态测试稳定通过。', level: 'fact', scope: 'haqi', status: 'active', source: '会话 · HAQI 社交改版', at: '10-13' },
    { id: 'hf5', text: '10-11 改了 CLI 没重启会话，验证时跑的还是旧代码。', level: 'fact', scope: 'haqi', status: 'active', source: '会话 · HAQI 账号切换', at: '10-11' },

    // 等你确认
    { id: 'q1', text: '以后修完可以直接推送，不用再问我。', level: 'principle', scope: GLOBAL_SCOPE, status: 'pending', reason: '和原则「不 push 到远程分支」相反', source: '会话 · HAQI 社交改版（说是你说的）', at: '1 小时前', replaces: 'g2',
        jev: { keep: 0.86, level: { choice: 'principle', confidence: 0.84 }, scope: { choice: GLOBAL_SCOPE, confidence: 0.79 } } },
    { id: 'q2', text: '等待类任务一律挂后台监控，有结果再汇报。', level: 'principle', scope: GLOBAL_SCOPE, status: 'pending', reason: '升级建议：这条经验已有 3 次支撑', source: '整理 · 由经验升级', at: '昨天 22:40', evidence: ['e4'] },
    { id: 'q3', text: 'Tailwind v4 禁用按钮不想要 hover，要写 enabled:hover:。', level: 'experience', scope: 'haqi', status: 'pending', reason: 'Jev 拿不准放全局还是不记', source: '会话 · HAQI 社交改版', at: '3 小时前',
        jev: { keep: 0.62, level: { choice: 'experience', confidence: 0.62 }, scope: { choice: GLOBAL_SCOPE, confidence: 0.24 } } },
    { id: 'q4', text: '凌晨的消息多半在手机上看，回复要更短。', level: 'experience', scope: GLOBAL_SCOPE, status: 'pending', reason: '推断，只有 1 条事实', source: '会话 · HAQI 社交改版', at: '昨天 02:15', evidence: ['f1'] }
]

/** What happened recently, newest first ("最近"). */
export const RECENT: Array<{ id: string; action: string }> = [
    { id: 'e7', action: '新记下' },
    { id: 'h3', action: '你改过' },
    { id: 'e1', action: '被加强' },
    { id: 'q1', action: '等你确认' },
    { id: 'q3', action: '等你确认' },
    { id: 'q2', action: '升级建议' },
    { id: 'g5', action: '被加强' }
]

export const SKIPPED_TODAY = { total: 7, detail: '寒暄 5 条、代码里已有 1 条、含密码 1 条' }

export const STATS = { addedToday: 5, jevRecent: 50, corrected: 4 }

export function findMemory(id: string): Memory | undefined {
    return MEMORIES.find((m) => m.id === id)
}

/** Short graph label. */
export const SHORT: Record<string, string> = {
    g1: '中文结论先行', g2: '不自动推送', g3: '只给公网链接', g4: '能验证就做完', g5: '截图放工单', h1: '发布先备份', h2: '测试不写库', h3: '三级成熟',
    e1: '入口最后拷', e2: '运行态断SSE', e3: '改CLI要重启', e7: 'token走存储', e4: '等待挂监控', e6: 'Jev不比冲突',
    f1: '嫌回复太长', f2: '要公网链接', f3: '外面打不开', f4: '追问好了没', f5: '又追问进度',
    hf1: 'sw.js白屏', hf2: '旧js报错', hf3: '心跳改回', hf4: '断SSE通过', hf5: '跑了旧代码',
    q1: '修完直接推?', q2: '一律挂监控', q3: 'hover写法', q4: '凌晨回复短'
}
