import type { Candidate, MemoryItem, MemoryLayer, MemoryLink, Maturity } from './types'

/** Prototype data. Jev numbers on candidates come from the 10-14 offline eval where one existed. */

export const USER_SECTIONS = ['沟通', '自主与审批', '交付与验证', '环境与工具', '其他'] as const
export const PROJECT_SECTIONS = ['架构', '构建部署', '测试验证', '坑', '约定', '其他'] as const

export const LAYER_LABEL: Record<MemoryLayer, string> = { user: '用户层', project: '项目层', task: '任务层' }
export const LAYER_HINT: Record<MemoryLayer, string> = {
    user: '注入所有会话',
    project: '只注入这个仓库的会话',
    task: '只给本会话，7 天后过期'
}
export const MATURITY_LABEL: Record<Maturity, string> = { fact: '事实', experience: '经验', principle: '原则' }
export const MATURITY_HINT: Record<Maturity, string> = {
    fact: '具体发生过的事，带时间和出处；只做证据，不注入',
    experience: '从事实归纳出的做法或判断，可能错；按项目注入',
    principle: '确认过的规则或偏好，直接约束行为；始终注入'
}

export const PROJECTS = [
    { key: 'haqi', name: 'haqi', count: 16 },
    { key: 'agent-engine', name: 'agent-engine', count: 4 },
    { key: 'shop-studio', name: 'shop-studio', count: 2 }
] as const

function v(version: number, text: string, at: string, by: string, note?: string) {
    return { version, text, at, by, note }
}

export const MEMORIES: MemoryItem[] = [
    // ── 用户层 · 原则 / 偏好
    { id: 'u1', layer: 'user', section: '沟通', maturity: 'principle', said: true, locked: true, status: 'active', support: 9, injected: true,
        text: '回复一律用中文，结论先行，不复述过程。', createdAt: '10-02', reinforcedAt: '10-14',
        versions: [v(1, '回复用中文。', '10-02', '你'), v(2, '回复用中文，结论先行。', '10-05', '会话 · HAQI 账号路由', '你补充“结论先行”'), v(3, '回复一律用中文，结论先行，不复述过程。', '10-09', '你', '网页上手改')],
        sources: ['你的消息 ×4', '会话提交 ×3', '导入 MEMORY.md'] },
    { id: 'u2', layer: 'user', section: '沟通', maturity: 'principle', said: true, status: 'active', support: 5, injected: true,
        text: '长任务每个里程碑汇报三行：完成了什么 / 正在做什么 / 需要你决定的事。', createdAt: '10-04', reinforcedAt: '10-13',
        versions: [v(1, '长任务每个里程碑汇报三行：完成了什么 / 正在做什么 / 需要你决定的事。', '10-04', '你')], sources: ['你的消息 ×3', '会话提交 ×2'] },
    { id: 'u3', layer: 'user', section: '自主与审批', maturity: 'principle', said: true, locked: true, status: 'active', support: 7, injected: true,
        text: '没有你当轮明确说“推送”，不得 push 到任何远程分支；多个小修攒在一起一次推。', createdAt: '10-03', reinforcedAt: '10-13',
        versions: [
            v(1, '不要自动 push。', '10-03', '你'),
            v(2, '不得往 dev 或其他远程分支主动推送。', '10-05', '会话 · HAQI main 部署'),
            v(3, '没有你当轮明确说“推送”，不得 push 到任何远程分支。', '10-08', '你'),
            v(4, '没有你当轮明确说“推送”，不得 push 到任何远程分支；多个小修攒在一起一次推。', '10-11', '整理会话', '并入“攒一次推”（原 u12）')
        ], sources: ['你的消息 ×5', '整理合并 ×1', '导入 MEMORY.md'] },
    { id: 'u4', layer: 'user', section: '自主与审批', maturity: 'principle', said: true, status: 'active', support: 6, injected: true,
        text: '能自己验证的直接做完再汇报；只有生产写操作、花钱、对外发送才停下确认。', createdAt: '10-03', reinforcedAt: '10-13',
        versions: [v(1, '能自己验证的直接做完再汇报；只有生产写操作、花钱、对外发送才停下确认。', '10-03', '你')], sources: ['你的消息 ×4', '导入 MEMORY.md'] },
    { id: 'u5', layer: 'user', section: '交付与验证', maturity: 'principle', said: true, status: 'active', support: 8, injected: true,
        text: '给你看的东西只给公网链接（报告 + 截图），发出前验证 200。', createdAt: '10-02', reinforcedAt: '10-13',
        versions: [v(1, '不要给 localhost 链接。', '10-02', '你'), v(2, '给你看的东西只给公网链接（报告 + 截图），发出前验证 200。', '10-06', '整理会话', '由 2 条事实归纳')],
        sources: ['你的消息 ×5', '事实 ×2'] },
    { id: 'u6', layer: 'user', section: '交付与验证', maturity: 'principle', said: true, status: 'active', support: 4, injected: true,
        text: '交付自检写清：改了什么、怎么验证、影响、风险和没做的部分。', createdAt: '10-04', reinforcedAt: '10-12',
        versions: [v(1, '交付自检写清：改了什么、怎么验证、影响、风险和没做的部分。', '10-04', '你')], sources: ['你的消息 ×2', '导入 MEMORY.md'] },
    { id: 'u7', layer: 'user', section: '交付与验证', maturity: 'principle', said: true, status: 'active', support: 3, injected: true,
        text: '截图和录屏放 Linear 工单，Obsidian 只放链接。', createdAt: '10-05', reinforcedAt: '10-13',
        versions: [v(1, '截图和录屏放 Linear 工单，Obsidian 只放链接。', '10-05', '你')], sources: ['你的消息 ×3'] },
    // ── 用户层 · 经验 / 推断
    { id: 'u11', layer: 'user', section: '自主与审批', maturity: 'experience', status: 'active', support: 3, injected: true,
        text: '等待类任务要挂后台监控；回复以“好了我再…”结尾时你会追问进度。', createdAt: '10-09', reinforcedAt: '10-13',
        versions: [v(1, '等待类任务要挂后台监控；回复以“好了我再…”结尾时你会追问进度。', '10-09', '整理会话', '由 2 条事实归纳')], sources: ['事实 ×2', '会话提交 ×1'] },
    { id: 'u9', layer: 'user', section: '沟通', maturity: 'experience', inference: true, status: 'pending', support: 1, injected: false,
        text: '凌晨的消息多半在手机上看，回复要更短。', createdAt: '10-13', reinforcedAt: '10-13',
        versions: [v(1, '凌晨的消息多半在手机上看，回复要更短。', '10-13', '会话 · HAQI 社交改版', '推断')], sources: ['事实 ×1'] },
    { id: 'u10', layer: 'user', section: '交付与验证', maturity: 'experience', inference: true, status: 'pending', support: 2, injected: false,
        text: '表格超过 3 张的报告你很少看完，长明细放附录。', createdAt: '10-12', reinforcedAt: '10-13',
        versions: [v(1, '表格超过 3 张的报告你很少看完，长明细放附录。', '10-12', '整理会话', '推断')], sources: ['会话提交 ×2'] },
    // ── 用户层 · 事实
    { id: 'uf1', layer: 'user', section: '交付与验证', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-02 你要求把报告链接换成公网地址。', createdAt: '10-02', reinforcedAt: '10-02', versions: [], sources: ['你的消息'] },
    { id: 'uf2', layer: 'user', section: '交付与验证', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-06 你说在外面打不开 localhost。', createdAt: '10-06', reinforcedAt: '10-06', versions: [], sources: ['你的消息'] },
    { id: 'uf3', layer: 'user', section: '沟通', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-13 02:10 你在手机上说回复太长。', createdAt: '10-13', reinforcedAt: '10-13', versions: [], sources: ['你的消息'] },
    { id: 'uf4', layer: 'user', section: '自主与审批', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-09 你两次追问“好了没”，当时后台任务没挂监控。', createdAt: '10-09', reinforcedAt: '10-09', versions: [], sources: ['你的消息'] },
    { id: 'uf5', layer: 'user', section: '自主与审批', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-13 你又追问一次进度，任务跑了 25 分钟没汇报。', createdAt: '10-13', reinforcedAt: '10-13', versions: [], sources: ['你的消息'] },
    // ── 用户层 · 冲突中的候选
    { id: 'x1', layer: 'user', section: '自主与审批', maturity: 'principle', status: 'conflict', support: 0, injected: false,
        text: '以后修完可以直接推送，不用再问我。', createdAt: '10-14', reinforcedAt: '10-14',
        versions: [v(1, '以后修完可以直接推送，不用再问我。', '10-14', '会话 · HAQI 社交改版', '会话称“你说的”')], sources: ['会话提交 ×1'] },

    // ── 项目层 haqi
    { id: 'p1', layer: 'project', project: 'haqi', section: '构建部署', maturity: 'principle', status: 'active', support: 6, injected: true,
        text: '发正式站前备份 dist，出问题直接拷回去回滚。', createdAt: '10-08', reinforcedAt: '10-13',
        versions: [v(1, '发布前备份 dist。', '10-08', '会话 · HAQI main 部署'), v(2, '发正式站前备份 dist，出问题直接拷回去回滚。', '10-09', '你', '你确认升为原则')], sources: ['会话提交 ×4', '事实 ×2'] },
    { id: 'p2', layer: 'project', project: 'haqi', section: '测试验证', maturity: 'principle', said: true, locked: true, status: 'active', support: 5, injected: true,
        text: '测试一律拦截非 GET 请求，不写真实数据。', createdAt: '10-07', reinforcedAt: '10-13',
        versions: [v(1, '测试一律拦截非 GET 请求，不写真实数据。', '10-07', '你')], sources: ['你的消息 ×2', '会话提交 ×3'] },
    { id: 'p3', layer: 'project', project: 'haqi', section: '约定', maturity: 'principle', status: 'active', support: 3, injected: true,
        text: '合并到 main 时不动其他会话未提交的文件。', createdAt: '10-13', reinforcedAt: '10-13',
        versions: [v(1, '合并到 main 时不动其他会话未提交的文件。', '10-13', '你', '你确认升为原则')], sources: ['事实 ×1', '会话提交 ×2'] },
    { id: 'p4', layer: 'project', project: 'haqi', section: '构建部署', maturity: 'experience', status: 'active', support: 3, injected: true,
        text: '部署 web 时 sw.js、404.html、index.html 最后拷，避免刷新到半新半旧的页面。', createdAt: '10-08', reinforcedAt: '10-14',
        versions: [v(1, '部署 web 时 index.html 最后拷。', '10-08', '会话 · HAQI main 部署'), v(2, '部署 web 时 sw.js、404.html、index.html 最后拷，避免刷新到半新半旧的页面。', '10-13', '整理会话', '由 2 条事实归纳')],
        sources: ['事实 ×2', 'Claude 自带记忆 ×1'] },
    { id: 'p5', layer: 'project', project: 'haqi', section: '测试验证', maturity: 'experience', status: 'active', support: 3, injected: true,
        text: '测“运行中”状态要先断开 /api/events 并清掉会话缓存，否则心跳会覆盖伪造状态。', createdAt: '10-13', reinforcedAt: '10-14',
        versions: [v(1, '测“运行中”状态要先断开 /api/events 并清掉会话缓存，否则心跳会覆盖伪造状态。', '10-13', '会话 · HAQI 社交改版')], sources: ['事实 ×2', 'Claude 自带记忆 ×1'] },
    { id: 'p6', layer: 'project', project: 'haqi', section: '坑', maturity: 'experience', status: 'active', support: 3, injected: true,
        text: 'runner 直接跑 CLI 源码，改了 CLI 要重启受影响的会话再验证。', createdAt: '10-11', reinforcedAt: '10-12',
        versions: [v(1, 'runner 直接跑 CLI 源码，改了 CLI 要重启受影响的会话再验证。', '10-11', '会话 · HAQI 账号切换')], sources: ['事实 ×1', '导入 MEMORY.md'] },
    { id: 'p9', layer: 'project', project: 'haqi', section: '测试验证', maturity: 'experience', status: 'active', support: 1, injected: true,
        text: 'Playwright 截图用 localStorage 种 token，别把 token 放进 URL。', createdAt: '10-14', reinforcedAt: '10-14',
        versions: [v(1, 'Playwright 截图用 localStorage 种 token，别把 token 放进 URL。', '10-14', '会话 · HAQI 记忆页设计')], sources: ['会话提交 ×1'] },
    { id: 'p7', layer: 'project', project: 'haqi', section: '坑', maturity: 'experience', status: 'pending', support: 1, injected: false,
        text: 'Tailwind v4 禁用按钮不想要 hover，要写 enabled:hover:。', createdAt: '10-13', reinforcedAt: '10-13',
        versions: [v(1, 'Tailwind v4 禁用按钮不想要 hover，要写 enabled:hover:。', '10-13', '会话 · HAQI 社交改版')], sources: ['会话提交 ×1'] },
    { id: 'p8', layer: 'project', project: 'haqi', section: '构建部署', maturity: 'principle', status: 'pending', support: 2, injected: false,
        text: '发布要原子切换：先备份，入口文件最后替换。', createdAt: '10-13', reinforcedAt: '10-13',
        versions: [v(1, '发布要原子切换：先备份，入口文件最后替换。', '10-13', '整理会话', '升级提议：由 p1、p4 归纳')], sources: ['p1', 'p4'] },
    // ── 项目层 haqi · 事实
    { id: 'pf1', layer: 'project', project: 'haqi', section: '构建部署', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-13 先拷 sw.js，页面白屏 3 分钟，已回滚。', createdAt: '10-13', reinforcedAt: '10-13', versions: [], sources: ['会话 · HAQI 社交改版'] },
    { id: 'pf2', layer: 'project', project: 'haqi', section: '构建部署', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-08 index.html 先更新，刷新后拿到旧 js 报错。', createdAt: '10-08', reinforcedAt: '10-08', versions: [], sources: ['会话 · HAQI main 部署'] },
    { id: 'pf3', layer: 'project', project: 'haqi', section: '测试验证', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-13 SSE 心跳把伪造的 thinking 改回 false。', createdAt: '10-13', reinforcedAt: '10-13', versions: [], sources: ['会话 · HAQI 社交改版'] },
    { id: 'pf4', layer: 'project', project: 'haqi', section: '测试验证', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-13 断开 /api/events 后运行态测试稳定通过。', createdAt: '10-13', reinforcedAt: '10-13', versions: [], sources: ['会话 · HAQI 社交改版'] },
    { id: 'pf5', layer: 'project', project: 'haqi', section: '约定', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-13 main 上有其他会话未提交的改动 25 处。', createdAt: '10-13', reinforcedAt: '10-13', versions: [], sources: ['会话 · HAQI 社交改版'] },
    { id: 'pf6', layer: 'project', project: 'haqi', section: '构建部署', maturity: 'fact', status: 'stale', support: 0, injected: false,
        text: '10-08 正式站发布 index-Cq3vR0.js，备份在 /tmp。', createdAt: '10-08', reinforcedAt: '10-08', versions: [], sources: ['会话 · HAQI main 部署'] },
    { id: 'pf7', layer: 'project', project: 'haqi', section: '坑', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-11 改了 CLI 没重启会话，验证时跑的还是旧代码。', createdAt: '10-11', reinforcedAt: '10-11', versions: [], sources: ['会话 · HAQI 账号切换'] },

    // ── 项目层 agent-engine
    { id: 'a1', layer: 'project', project: 'agent-engine', section: '架构', maturity: 'experience', status: 'active', support: 2, injected: true,
        text: 'Jev 比较两条规则是否冲突不准（10 组对 4–5 组），合并改写交给大模型。', createdAt: '10-14', reinforcedAt: '10-14',
        versions: [v(1, 'Jev 比较两条规则是否冲突不准（10 组对 4–5 组），合并改写交给大模型。', '10-14', '会话 · HAQI 记忆设计')], sources: ['事实 ×2'] },
    { id: 'a2', layer: 'project', project: 'agent-engine', section: '其他', maturity: 'experience', status: 'active', support: 1, injected: true,
        text: '抽取时把“下周五”这类相对日期换成绝对日期。', createdAt: '10-14', reinforcedAt: '10-14',
        versions: [v(1, '抽取时把“下周五”这类相对日期换成绝对日期。', '10-14', '会话 · agent-engine 记忆评测')], sources: ['会话提交 ×1'] },
    { id: 'af1', layer: 'project', project: 'agent-engine', section: '架构', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-14 Jev 关系判断 v1：10 组对 4 组。', createdAt: '10-14', reinforcedAt: '10-14', versions: [], sources: ['会话 · HAQI 记忆设计'] },
    { id: 'af2', layer: 'project', project: 'agent-engine', section: '架构', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '10-14 Jev 关系判断 v2（拆成小问题）：10 组对 5 组。', createdAt: '10-14', reinforcedAt: '10-14', versions: [], sources: ['会话 · HAQI 记忆设计'] },

    // ── 任务层
    { id: 't1', layer: 'task', section: '进展', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '这一轮先做记忆页原型，用假数据，不接后端。', createdAt: '10-14', reinforcedAt: '10-14', versions: [], sources: ['会话 · HAQI 记忆页设计'] },
    { id: 't2', layer: 'task', section: '进展', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '你要求记忆分三层成熟：事实 → 推断和经验 → 原则和偏好。', createdAt: '10-14', reinforcedAt: '10-14', versions: [], sources: ['你的消息'] },
    { id: 't3', layer: 'task', section: '进展', maturity: 'fact', status: 'active', support: 0, injected: false,
        text: '这一轮测试用的会话是 949c74c8，标签 prod、pinned。', createdAt: '10-13', reinforcedAt: '10-13', versions: [], sources: ['会话 · HAQI 社交改版'] }
]

export const LINKS: MemoryLink[] = [
    { from: 'uf1', to: 'u5', kind: 'supports' },
    { from: 'uf2', to: 'u5', kind: 'supports' },
    { from: 'uf3', to: 'u9', kind: 'supports' },
    { from: 'uf4', to: 'u11', kind: 'supports' },
    { from: 'uf5', to: 'u11', kind: 'supports' },
    { from: 'u11', to: 'u4', kind: 'supports' },
    { from: 'x1', to: 'u3', kind: 'conflicts' },
    { from: 'pf1', to: 'p4', kind: 'supports' },
    { from: 'pf2', to: 'p4', kind: 'supports' },
    { from: 'pf6', to: 'p1', kind: 'supports' },
    { from: 'p4', to: 'p8', kind: 'supports' },
    { from: 'p1', to: 'p8', kind: 'supports' },
    { from: 'pf3', to: 'p5', kind: 'supports' },
    { from: 'pf4', to: 'p5', kind: 'supports' },
    { from: 'pf5', to: 'p3', kind: 'supports' },
    { from: 'pf7', to: 'p6', kind: 'supports' },
    { from: 'af1', to: 'a1', kind: 'supports' },
    { from: 'af2', to: 'a1', kind: 'supports' }
]

const SCOPE_LABELS = { user: '用户层', project: '项目层', task: '任务层', none: '不记' }

function scope(user: number, project: number, task: number, none: number, confidence: number) {
    return { kind: 'choice' as const, label: '放哪一层', probs: { [SCOPE_LABELS.user]: user, [SCOPE_LABELS.project]: project, [SCOPE_LABELS.task]: task, [SCOPE_LABELS.none]: none }, confidence }
}
function choice(label: string, probs: Record<string, number>, confidence: number) {
    return { kind: 'choice' as const, label, probs, confidence }
}
function noul(label: string, p: number) {
    return { kind: 'noul' as const, label, p }
}
function maturity(fact: number, experience: number, principle: number, confidence: number) {
    return choice('成熟度', { 事实: fact, 经验: experience, 原则: principle }, confidence)
}

export const CANDIDATES: Candidate[] = [
    {
        id: 'c1', at: '2 分钟前', source: 'propose', agent: 'Claude', session: 'HAQI 记忆页设计', project: 'haqi',
        text: 'Playwright 截图用 localStorage 种 token，别把 token 放进 URL。',
        jev: { latencyMs: 402, costUsd: 0.00006, answers: {
            lasting: noul('值得长期记吗', 0.81),
            scope: scope(0.15, 0.74, 0.08, 0.03, 0.62),
            section: choice('哪一节', { 架构: 0.03, 构建部署: 0.04, 测试验证: 0.88, 坑: 0.03, 约定: 0.01, 其他: 0.01 }, 0.84),
            maturity: maturity(0.06, 0.23, 0.71, 0.58),
            secret: noul('含密钥原文', 0.02),
            match: choice('对应旧条目', { p2: 0.31, p5: 0.06, 无: 0.63 }, 0.4)
        } },
        rules: [
            { ok: true, text: '不含密钥（0.02）' },
            { ok: true, text: '值得长期记（0.81 ≥ 0.3）' },
            { ok: true, text: '项目层 0.74，置信 0.62 ≥ 0.6 → 项目层' },
            { ok: true, text: '测试验证 0.88 → 测试验证' },
            { ok: false, text: '判为原则，但来自会话推断 → 先按经验入库，攒够支撑再升' },
            { ok: true, text: '没有对应旧条目（无 0.63）→ 新增' }
        ],
        outcome: 'written', result: { layer: 'project', section: '测试验证', maturity: 'experience', memoryId: 'p9', note: '新增 p9 · haqi / 测试验证 · 经验' }
    },
    {
        id: 'c2', at: '9 分钟前', source: 'user_message', session: 'HAQI 记忆页设计', project: 'haqi', said: true,
        text: '记忆要分三层成熟：事实 → 推断和经验 → 原则和偏好。',
        jev: { latencyMs: 388, costUsd: 0.00005, answers: {
            lasting: noul('值得长期记吗', 0.47),
            scope: scope(0.18, 0.3, 0.48, 0.04, 0.21),
            section: choice('哪一节', { 架构: 0.62, 构建部署: 0.02, 测试验证: 0.03, 坑: 0.02, 约定: 0.21, 其他: 0.1 }, 0.42),
            maturity: maturity(0.55, 0.1, 0.35, 0.3),
            secret: noul('含密钥原文', 0.01),
            match: choice('对应旧条目', { 无: 0.9, a1: 0.06, p8: 0.04 }, 0.82)
        } },
        rules: [
            { ok: true, text: '不含密钥（0.01）' },
            { ok: true, text: '值得长期记（0.47 ≥ 0.3）' },
            { ok: false, text: '层置信 0.21 < 0.6：任务层 ↔ 项目层拿不准 → 退到更窄的任务层' },
            { ok: true, text: '任务层自动写入，会话结束 7 天后过期' }
        ],
        outcome: 'written', result: { layer: 'task', section: '进展', maturity: 'fact', memoryId: 't2', note: '写入任务层 t2（7 天后过期）' }
    },
    {
        id: 'c3', at: '15 分钟前', source: 'claude_auto', session: 'Claude 自带记忆 · haqi-prod-web-deploy.md', project: 'haqi',
        text: '正式站 web 由 hub 从磁盘读 dist；部署 = 构建到 dist.new → 备份 → rsync → 最后拷 sw.js / 404 / index。',
        jev: { latencyMs: 433, costUsd: 0.00007, answers: {
            lasting: noul('值得长期记吗', 0.9),
            scope: scope(0.02, 0.93, 0.04, 0.01, 0.88),
            section: choice('哪一节', { 架构: 0.02, 构建部署: 0.95, 测试验证: 0.01, 坑: 0.01, 约定: 0.01, 其他: 0 }, 0.91),
            maturity: maturity(0.2, 0.66, 0.14, 0.45),
            secret: noul('含密钥原文', 0.01),
            match: choice('对应旧条目', { p4: 0.91, p1: 0.06, 无: 0.03 }, 0.86)
        } },
        rules: [
            { ok: true, text: '不含密钥（0.01）' },
            { ok: true, text: '项目层 0.93 · 构建部署 0.95' },
            { ok: true, text: '对应 p4（0.91 ≥ 0.8）→ p4 支撑 +1（2 → 3）' },
            { ok: false, text: '有 p4 没写的新内容（rsync 步骤）→ 交给整理会话合并，合并稿待你确认' }
        ],
        outcome: 'reinforced', result: { layer: 'project', section: '构建部署', maturity: 'experience', memoryId: 'p4', note: 'p4 支撑 2 → 3 · 合并稿待确认' }
    },
    {
        id: 'c6', at: '1 小时前', source: 'propose', agent: 'Claude', session: 'HAQI 社交改版', said: true,
        text: '以后修完可以直接推送，不用再问我。',
        jev: { latencyMs: 395, costUsd: 0.00006, answers: {
            lasting: noul('值得长期记吗', 0.86),
            scope: scope(0.88, 0.07, 0.04, 0.01, 0.79),
            section: choice('哪一节', { 沟通: 0.03, 自主与审批: 0.93, 交付与验证: 0.03, 环境与工具: 0.01, 其他: 0 }, 0.9),
            maturity: maturity(0.04, 0.06, 0.9, 0.84),
            secret: noul('含密钥原文', 0),
            match: choice('对应旧条目', { u3: 0.97, u4: 0.02, 无: 0.01 }, 0.95)
        } },
        rules: [
            { ok: true, text: '用户层 0.88 · 自主与审批 0.93' },
            { ok: true, text: '对应 u3（0.97）' },
            { ok: false, text: '与锁定条目 u3 说法相反 → 不自动写入，交给你裁决' }
        ],
        outcome: 'pending', result: { layer: 'user', section: '自主与审批', maturity: 'principle', memoryId: 'x1', note: '与 u3（锁定）冲突，等你裁决' }
    },
    {
        id: 'c8', at: '2 小时前', source: 'claude_auto', session: 'Claude 自带记忆 · haqi-web-ui-verification.md', project: 'haqi',
        text: '伪造“运行中”要断开 /api/events，并清掉 hapi:sessionDetail 缓存再刷新。',
        jev: { latencyMs: 410, costUsd: 0.00006, answers: {
            lasting: noul('值得长期记吗', 0.85),
            scope: scope(0.04, 0.9, 0.05, 0.01, 0.84),
            section: choice('哪一节', { 架构: 0.01, 构建部署: 0.01, 测试验证: 0.93, 坑: 0.04, 约定: 0.01, 其他: 0 }, 0.9),
            maturity: maturity(0.12, 0.7, 0.18, 0.52),
            secret: noul('含密钥原文', 0),
            match: choice('对应旧条目', { p5: 0.95, p2: 0.03, 无: 0.02 }, 0.93)
        } },
        rules: [
            { ok: true, text: '项目层 0.90 · 测试验证 0.93' },
            { ok: true, text: '对应 p5（0.95）→ 支撑 +1（2 → 3）；内容已被 p5 覆盖，不新增' }
        ],
        outcome: 'reinforced', result: { layer: 'project', section: '测试验证', maturity: 'experience', memoryId: 'p5', note: 'p5 支撑 2 → 3' }
    },
    {
        id: 'c9', at: '3 小时前', source: 'propose', agent: 'Claude', session: 'HAQI 社交改版', project: 'haqi',
        text: 'Tailwind v4 禁用按钮不想要 hover，要写 enabled:hover:。',
        jev: { latencyMs: 377, costUsd: 0.00005, answers: {
            lasting: noul('值得长期记吗', 0.62),
            scope: scope(0.43, 0.13, 0.01, 0.43, 0.24),
            section: choice('哪一节', { 架构: 0.02, 构建部署: 0.01, 测试验证: 0.02, 坑: 0.58, 约定: 0.3, 其他: 0.07 }, 0.4),
            maturity: maturity(0.1, 0.62, 0.28, 0.45),
            secret: noul('含密钥原文', 0),
            match: choice('对应旧条目', { 无: 0.9, p6: 0.1 }, 0.84)
        } },
        rules: [
            { ok: true, text: '值得长期记（0.62）' },
            { ok: false, text: '层置信 0.24：用户层 ↔ 不记拿不准 → 进待确认（建议：项目层 / 坑）' }
        ],
        outcome: 'pending', result: { layer: 'project', section: '坑', maturity: 'experience', memoryId: 'p7', note: '层拿不准（0.24），建议 haqi / 坑' }
    },
    {
        id: 'c5', at: '34 分钟前', source: 'user_message', session: '周报数据整理', redacted: true,
        text: '测试库账号 admin，密码 ••••••••（已打码）',
        jev: { latencyMs: 365, costUsd: 0.00004, answers: {
            lasting: noul('值得长期记吗', 0.22),
            scope: scope(0.03, 0.24, 0.02, 0.71, 0.58),
            section: choice('哪一节', { 架构: 0.1, 构建部署: 0.3, 测试验证: 0.4, 坑: 0.1, 约定: 0.05, 其他: 0.05 }, 0.2),
            maturity: maturity(0.86, 0.1, 0.04, 0.78),
            secret: noul('含密钥原文', 0.97),
            match: choice('对应旧条目', { 无: 0.98 }, 0.97)
        } },
        rules: [
            { ok: true, text: '本地正则没命中（不是 key 格式）' },
            { ok: false, text: 'Jev 判定含密钥（0.97）→ 拒绝；日志只留打码后的文字' }
        ],
        outcome: 'rejected', result: { note: '已拒绝：含密码' }
    },
    {
        id: 'c4', at: '21 分钟前', source: 'propose', agent: 'Codex', session: 'agent-engine 记忆评测', project: 'agent-engine',
        text: '抽取时把“下周五”这类相对日期换成绝对日期。',
        jev: { latencyMs: 421, costUsd: 0.00005, answers: {
            lasting: noul('值得长期记吗', 0.78),
            scope: scope(0.06, 0.81, 0.1, 0.03, 0.66),
            section: choice('哪一节', { 架构: 0.2, 构建部署: 0.02, 测试验证: 0.14, 坑: 0.1, 约定: 0.45, 其他: 0.09 }, 0.31),
            maturity: maturity(0.08, 0.3, 0.62, 0.44),
            secret: noul('含密钥原文', 0),
            match: choice('对应旧条目', { 无: 0.95, a1: 0.05 }, 0.9)
        } },
        rules: [
            { ok: true, text: '项目层 0.81（agent-engine）' },
            { ok: false, text: '节置信 0.31 < 0.5 → 放进「其他」' },
            { ok: false, text: '判为原则，但来自会话推断 → 先按经验入库' },
            { ok: true, text: '新增 a2' }
        ],
        outcome: 'written', result: { layer: 'project', section: '其他', maturity: 'experience', memoryId: 'a2', note: '新增 a2 · agent-engine / 其他 · 经验' }
    },
    {
        id: 'c10', at: '昨天 22:40', source: 'curator', session: '整理会话 · 每日整理', project: 'haqi',
        text: '提议升为原则：“发布要原子切换：先备份，入口文件最后替换。”（依据 p1、p4）',
        jev: { latencyMs: 452, costUsd: 0.00008, answers: {
            lasting: noul('支撑核查：依据能撑起它吗', 0.5),
            scope: scope(0.03, 0.92, 0.03, 0.02, 0.86),
            section: choice('哪一节', { 架构: 0.05, 构建部署: 0.9, 测试验证: 0.01, 坑: 0.02, 约定: 0.02, 其他: 0 }, 0.85),
            maturity: maturity(0.02, 0.15, 0.83, 0.7),
            secret: noul('含密钥原文', 0),
            match: choice('对应旧条目', { p1: 0.52, p4: 0.41, 无: 0.07 }, 0.31)
        } },
        rules: [
            { ok: true, text: '项目层 0.92 · 构建部署 0.90 · 原则 0.83' },
            { ok: false, text: '支撑核查 0.50（0.2–0.6 之间）→ 升级需要你确认' }
        ],
        outcome: 'pending', result: { layer: 'project', section: '构建部署', maturity: 'principle', memoryId: 'p8', note: '升级提议：确认后 p8 生效，p4 作为依据保留' }
    },
    {
        id: 'c11', at: '昨天 18:05', source: 'user_message', session: '周报数据整理', said: true,
        text: '截图别放 Obsidian，传到 Linear 工单里。',
        jev: { latencyMs: 399, costUsd: 0.00005, answers: {
            lasting: noul('值得长期记吗', 0.88),
            scope: scope(0.91, 0.05, 0.03, 0.01, 0.86),
            section: choice('哪一节', { 沟通: 0.04, 自主与审批: 0.02, 交付与验证: 0.9, 环境与工具: 0.04, 其他: 0 }, 0.88),
            maturity: maturity(0.03, 0.11, 0.86, 0.78),
            secret: noul('含密钥原文', 0),
            match: choice('对应旧条目', { u7: 0.96, u5: 0.03, 无: 0.01 }, 0.95)
        } },
        rules: [
            { ok: true, text: '用户层 0.91 · 交付与验证 0.90' },
            { ok: true, text: '对应 u7（0.96）→ 同一件事，支撑 +1（2 → 3）' }
        ],
        outcome: 'reinforced', result: { layer: 'user', section: '交付与验证', maturity: 'principle', memoryId: 'u7', note: 'u7 支撑 2 → 3' }
    },
    {
        id: 'c12', at: '昨天 16:30', source: 'propose', agent: 'Claude', session: 'HAQI 社交改版', project: 'haqi',
        text: '这一轮测试用的会话是 949c74c8，标签是 prod 和 pinned。',
        jev: { latencyMs: 380, costUsd: 0.00005, answers: {
            lasting: noul('值得长期记吗', 0.08),
            scope: scope(0.02, 0.03, 0.46, 0.49, 0.32),
            section: choice('哪一节', { 架构: 0.1, 构建部署: 0.1, 测试验证: 0.6, 坑: 0.05, 约定: 0.05, 其他: 0.1 }, 0.3),
            maturity: maturity(0.92, 0.05, 0.03, 0.85),
            secret: noul('含密钥原文', 0.01),
            match: choice('对应旧条目', { 无: 0.97 }, 0.95)
        } },
        rules: [
            { ok: false, text: '层置信 0.32：任务层 ↔ 不记拿不准 → 退到任务层（7 天后自动过期）' }
        ],
        outcome: 'written', result: { layer: 'task', section: '进展', maturity: 'fact', memoryId: 't3', note: '写入任务层 t3（7 天后过期）' }
    },
    {
        id: 'c7', at: '1 小时前', source: 'user_message', session: 'HAQI 社交改版',
        text: '好的，继续。',
        jev: { latencyMs: 350, costUsd: 0.00003, answers: {
            lasting: noul('值得长期记吗', 0.03),
            scope: scope(0.01, 0.02, 0.07, 0.9, 0.86),
            section: choice('哪一节', { 其他: 1 }, 1),
            maturity: maturity(0.9, 0.05, 0.05, 0.8),
            secret: noul('含密钥原文', 0),
            match: choice('对应旧条目', { 无: 1 }, 1)
        } },
        rules: [{ ok: false, text: '寒暄（不记 0.90）→ 丢弃' }],
        outcome: 'rejected', result: { note: '已丢弃：寒暄' }
    }
]

export const TODAY = {
    captured: 38,
    judged: 37,
    timeout: 1,
    written: 12,
    reinforced: 9,
    pending: 7,
    rejected: 10,
    costUsd: 0.0021,
    latencyMs: 410,
    bySource: [
        { label: '会话提交', n: 21 },
        { label: 'Claude 自带记忆', n: 9 },
        { label: '你的消息', n: 6 },
        { label: '整理会话', n: 2 }
    ]
}

/** (confidence, correct) for "which layer", 52 synthetic candidates asked in two option orders (10-14 eval). */
export const SCOPE_CALIBRATION: Array<[number, 0 | 1]> = [[0.04,0],[0.2,0],[0.24,0],[0.25,0],[0.28,0],[0.31,1],[0.31,1],[0.32,0],[0.32,0],[0.32,1],[0.32,1],[0.35,1],[0.35,1],[0.35,1],[0.36,0],[0.37,0],[0.4,1],[0.41,1],[0.41,1],[0.43,1],[0.45,1],[0.48,1],[0.49,0],[0.51,0],[0.51,1],[0.51,1],[0.52,1],[0.53,1],[0.56,1],[0.56,1],[0.57,1],[0.59,1],[0.6,1],[0.65,1],[0.65,1],[0.65,1],[0.67,1],[0.68,1],[0.69,1],[0.71,1],[0.72,1],[0.72,1],[0.73,1],[0.73,1],[0.73,1],[0.75,1],[0.76,0],[0.77,1],[0.81,0],[0.83,1],[0.83,1],[0.83,1],[0.85,1],[0.85,1],[0.85,1],[0.87,1],[0.87,1],[0.87,1],[0.87,1],[0.88,1],[0.88,1],[0.88,1],[0.88,1],[0.91,1],[0.91,1],[0.91,1],[0.92,1],[0.92,1],[0.92,1],[0.93,1],[0.93,1],[0.93,1],[0.93,1],[0.93,1],[0.95,1],[0.95,1],[0.95,1],[0.95,1],[0.96,1],[0.96,1],[0.96,1],[0.96,1],[0.97,1],[0.99,1],[0.99,1],[0.99,1],[0.99,1],[0.99,1],[0.99,1],[0.99,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1]]

export const JEV_QUESTIONS = [
    { key: 'lasting', label: '值得长期记吗', type: '是/否', offline: '96%', n: '52 条', note: '', corrections: 1 },
    { key: 'scope', label: '放哪一层', type: '多选一', offline: '88%', n: '52 条 × 2 种顺序', note: '置信 ≥0.6 时 97%', corrections: 3 },
    { key: 'section', label: '哪一节', type: '多选一', offline: '90%', n: '50 条', note: '', corrections: 2 },
    { key: 'maturity', label: '成熟度', type: '多选一', offline: '100%', n: '24 条 × 2 种顺序', note: '样本偏干净', corrections: 1 },
    { key: 'secret', label: '含密钥原文', type: '是/否', offline: '98%', n: '52 条', note: '本地正则先过一遍', corrections: 0 },
    { key: 'match', label: '对应旧条目', type: '多选一', offline: '80%', n: '10 组', note: '判对时置信 ≥0.94', corrections: 0 },
    { key: 'support', label: '支撑核查', type: '是/否', offline: '80%', n: '10 组', note: '“不支撑”判得准，“支撑”偏保守', corrections: 0 },
    { key: 'relation', label: '重复 / 补充 / 冲突', type: '—', offline: '40–50%', n: '10 组', note: '不用 Jev，交给大模型', corrections: 0 }
] as const

export const CRITERIA_SCOPE = [
    { key: 'user', label: '用户层', text: '关于你本人、在任何项目都成立：回复的语言语气长短、怎么汇报、什么要你批准、怎么验收交付、你到处都用的工具和账号。', test: '明天换一个完全不同的项目，这条还成立吗？' },
    { key: 'project', label: '项目层', text: '关于这个仓库：怎么构建、运行、测试、部署；架构决定；命令、环境、地址；这个仓库的代码和提交约定；在这里踩过的坑。', test: '对这个仓库以后的会话有用，换个项目就没用。' },
    { key: 'task', label: '任务层', text: '当前这件事的进展：刚做了什么、下一步、这一轮的临时决定、这次任务的 ID 和数字。', test: '这件事做完就没用了。' },
    { key: 'none', label: '不记', text: '寒暄、确认；代码、文件、配置或 git 历史里直接能看到的；密钥原文。', test: '' }
] as const

export const REPLAY_DIFF = [
    { text: 'Tailwind v4 禁用按钮不想要 hover，要写 enabled:hover:。', before: '待确认（用户 0.43 / 不记 0.43）', after: '项目层 · 坑（0.71）' },
    { text: 'CDP 触摸事件可以模拟手机长按。', before: '不记（0.40）', after: '项目层 · 测试验证（0.66）' },
    { text: 'main 上经常有别的会话没提交的改动。', before: '用户层（0.46）', after: '项目层 · 约定（0.74）' },
    { text: 'README 里写了怎么跑 bun run dev。', before: '项目层（0.82）', after: '不记（0.69）' }
]

export const HEALTH = [
    { tone: 'danger' as const, title: '冲突待裁决 1 条', body: '“以后修完可以直接推送”与锁定的 u3 相反。来源会话称“你说的”，原话没找到。' },
    { tone: 'warning' as const, title: '同一件事被你纠正了第 2 次', body: '你在「周报数据」里又提醒“只给公网链接”。u5 已存在，但这个会话启动早于 u5 v2，没注入到。' },
    { tone: 'muted' as const, title: '可能过时 2 条', body: 'pf6「10-08 正式站发布 index-Cq3vR0.js」等 2 条事实 6 天没被引用，建议归档。' },
    { tone: 'muted' as const, title: '用户层 1,240 / 1,500 token', body: '再加 3–4 条原则就要压缩；整理会话会先压事实和低支撑的经验。' }
]

export const WEEKLY_REVIEW = ['u2', 'p1', 'u6']

export const TIMELINE_DAYS = ['10-02', '10-03', '10-04', '10-05', '10-06', '10-07', '10-08', '10-09', '10-11', '10-12', '10-13', '10-14']

/** Short labels for graph nodes (≤ 6 characters). */
export const GRAPH_LABEL: Record<string, string> = {
    u1: '中文结论先行', u2: '三行汇报', u3: '不自动推送', x1: '修完直接推?', u4: '能验证就做', u5: '只给公网链接', u6: '交付自检', u7: '截图放Linear',
    u9: '凌晨回复短', u11: '等待挂监控', u10: '报告少表格',
    uf3: '嫌回复太长', uf4: '追问好了没', uf5: '又追问进度', uf1: '要公网链接', uf2: '外面打不开',
    p1: '发布先备份', p8: '原子切换', p2: '测试不写库', p3: '不动别人改动',
    p4: '入口最后拷', p5: '运行态断SSE', p6: '改CLI要重启', p9: 'token走存储', p7: 'hover写法',
    pf6: '10-08发布', pf1: 'sw.js白屏', pf2: '旧js报错', pf3: '心跳改回', pf4: '断SSE通过', pf7: '跑了旧代码', pf5: '25处未提交',
    a1: 'Jev不比冲突', a2: '日期转绝对', af1: '关系4/10', af2: '关系5/10',
    t1: '原型假数据', t2: '三层成熟', t3: '测试会话id'
}

/** Graph regions (columns) and the node order inside each maturity band. */
export const GRAPH_REGIONS: Array<{ key: string; label: string; layer: 'user' | 'project' | 'task'; bands: Record<'principle' | 'experience' | 'fact', string[]> }> = [
    { key: 'user', label: '用户层', layer: 'user', bands: { principle: ['u1', 'u2', 'u3', 'x1', 'u4', 'u5', 'u6', 'u7'], experience: ['u9', 'u11', 'u10'], fact: ['uf3', 'uf4', 'uf5', 'uf1', 'uf2'] } },
    { key: 'haqi', label: 'haqi', layer: 'project', bands: { principle: ['p1', 'p8', 'p2', 'p3'], experience: ['p4', 'p5', 'p6', 'p9', 'p7'], fact: ['pf6', 'pf1', 'pf2', 'pf3', 'pf4', 'pf7', 'pf5'] } },
    { key: 'agent-engine', label: 'agent-engine', layer: 'project', bands: { principle: [], experience: ['a1', 'a2'], fact: ['af1', 'af2'] } },
    { key: 'task', label: '任务层', layer: 'task', bands: { principle: [], experience: [], fact: ['t1', 't2', 't3'] } }
]

/** What happened to the network each day (for the replay slider). */
export const GRAPH_EVENTS: Record<string, string[]> = {
    '10-02': ['导入 MEMORY.md：u1、u5 作为原则（你说）'],
    '10-03': ['u3、u4 写入（你说）'],
    '10-05': ['u7 写入（你说）'],
    '10-06': ['u5 v2：由 2 条事实归纳改写'],
    '10-08': ['p4 v1、pf2：部署时 index.html 先更新踩坑'],
    '10-09': ['p1 你确认升为原则', 'u11 由 2 条事实归纳成经验'],
    '10-11': ['u3 v4：整理会话把“攒一次推”并进来', 'p6 写入'],
    '10-13': ['p4 v2 归纳（sw.js 白屏）', 'p3 你确认升为原则', 'p8 升级提议（待确认）', 'u9 推断（待确认）'],
    '10-14': ['x1 与 u3 冲突（待裁决）', 'p9、a1、a2 新增', 'p4、p5 各被加强 1 次']
}
