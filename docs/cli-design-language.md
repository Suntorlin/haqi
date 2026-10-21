# CLI Design Language Specification

> 参考 PlanetScale、Vercel、Railway、Stripe 等现代 CLI 工具，以及 [clig.dev](https://clig.dev) 设计指南、
> [Charm](https://charm.sh) 生态（Lip Gloss / Bubble Tea）的视觉与交互模式。

---

## 1. Design Style — 设计风格

### 1.1 色彩规范（Semantic Colors）

采用语义化色彩系统，所有颜色均映射到 ANSI 256 / True Color，并自动降级到 16 色终端。

| 语义角色     | 色值（True Color）   | ANSI 16 回退     | 用途                         |
| ------------ | -------------------- | ---------------- | ---------------------------- |
| **Primary**  | `#7C3AED` (紫)       | Magenta          | 品牌色、活动焦点、选中态     |
| **Success**  | `#22C55E` (绿)       | Green            | 完成、通过、创建成功         |
| **Warning**  | `#EAB308` (黄)       | Yellow           | 警告、需要注意               |
| **Error**    | `#EF4444` (红)       | Red              | 错误、失败、销毁操作         |
| **Info**     | `#3B82F6` (蓝)       | Blue             | 提示信息、链接               |
| **Muted**    | `#6B7280` (灰)       | Bright Black     | 辅助文字、时间戳、ID 缩写    |
| **Surface**  | `#1F2937` (深灰)     | —                | 面板/卡片背景（可选）        |

**色彩使用原则：**

```
✗ 不要：整行染色、彩虹式输出（Christmas tree effect）
✓ 要：仅对关键信号点着色（状态标记、操作动词、关键值）
```

**环境感知：**
- 检测 `NO_COLOR` 环境变量 → 禁用所有颜色
- 检测 `TERM=dumb` → 降级为纯文本
- 非 TTY（管道 / 重定向）→ 自动去除 ANSI 转义

### 1.2 字体排版（Typography in Monospace）

终端下所有字符等宽，信息层级通过以下方式建立：

| 层级 | 手法               | 示例                          |
| ---- | ------------------ | ----------------------------- |
| H1   | **Bold** + 大写     | `DEPLOYING TO PRODUCTION`     |
| H2   | **Bold**           | `Database Branches`           |
| 正文 | 常规                | `Created branch "staging"`    |
| 辅助 | Dim（暗淡）         | `2s ago · us-east-1`          |
| 链接 | Underline + 蓝色    | `https://app.example.com`     |
| 代码 | 反引号或高亮背景    | `` `pscale branch create` ``  |

**行宽约束：**
- 主内容区域不超过 80 列
- 表格/列表可扩展至终端宽度，但需设置 `max-width`
- 超长文本使用省略号截断（见 §2）

### 1.3 图标与符号（Icons & Symbols）

使用 Unicode 符号，不依赖 Nerd Font。符号必须在常见终端（iTerm2、Windows Terminal、GNOME Terminal）中可靠显示。

| 符号 | 用途               | 示例输出                          |
| ---- | ------------------ | --------------------------------- |
| `✓`  | 成功/完成          | `✓ Deployment complete`           |
| `✗`  | 失败/错误          | `✗ Build failed`                  |
| `●`  | 活跃/在线状态      | `● production (active)`           |
| `○`  | 非活跃/离线        | `○ staging (sleeping)`            |
| `▸`  | 列表项/导航箭头    | `▸ Select a database`             |
| `⠋`  | Spinner 帧         | `⠋ Connecting...`（Braille 动画） |
| `─`  | 水平分隔线         | `────────────────────`            |
| `│`  | 垂直边框/树形线    | `│  └── index.ts`                 |
| `◆`  | 交互式 Prompt 标记 | `◆ Which environment?`            |
| `→`  | 流向/结果指示      | `→ https://app.vercel.app`        |

**Spinner 规范：**
- 使用 Braille dot 模式：`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`
- 帧率：80ms
- Spinner 消失后替换为结果符号（`✓` 或 `✗`）

---

## 2. Compact Design — 紧缩设计

### 2.1 信息密度（Information Density）

**核心原则：每一行都必须传递有效信息，杜绝装饰性空行。**

```
# ✗ 低密度（浪费空间）
╔══════════════════════════╗
║                          ║
║   Deploy successful!     ║
║                          ║
╚══════════════════════════╝

# ✓ 高密度（清晰紧凑）
✓ Deployed to production · https://app.vercel.app · 2.3s
```

### 2.2 截断与省略策略

| 内容类型   | 策略                           | 示例                                    |
| ---------- | ------------------------------ | --------------------------------------- |
| 长路径     | 保留首尾，中间省略             | `/Users/…/src/index.ts`                 |
| 长 ID      | 保留前 8 字符                  | `deploy_a1b2c3d4`                       |
| 长 URL     | 保留域名 + 路径首段            | `app.vercel.app/dashboard/…`            |
| 时间戳     | 相对时间优先                   | `2m ago` / `3h ago` / `Mar 15`          |
| 长字符串   | 截断至列宽 - 3，追加 `...`     | `This is a very long com...`            |
| 哈希值     | 前 7-8 字符                    | `a1b2c3d` (git-style)                   |

### 2.3 渐进式披露（Progressive Disclosure）

```
# 默认输出（Level 0）— 只展示结果
✓ Deployed to production

# --verbose（Level 1）— 展示过程
✓ Build completed in 12.3s
✓ 3 functions bundled (245KB total)
✓ Deployed to production · https://app.vercel.app

# --debug（Level 2）— 展示诊断信息
[debug] POST /v13/deployments 200 (342ms)
[debug] Upload: 12 files, 1.2MB
[debug] Build: node@18, next@14.1.0
✓ Build completed in 12.3s
✓ 3 functions bundled (245KB total)
✓ Deployed to production · https://app.vercel.app
```

**标准 Verbosity 层级：**

| Flag         | 级别   | 输出内容                  |
| ------------ | ------ | ------------------------- |
| `-q`         | Quiet  | 仅错误                    |
| （默认）     | Normal | 结果 + 关键状态变化       |
| `-v`         | Verbose| 完整过程                  |
| `--debug`    | Debug  | 诊断信息 + HTTP 请求日志  |

### 2.4 表格紧凑排版

```
# ✓ 紧凑表格（列对齐 + 空格分隔，无边框）
NAME          STATUS    BRANCH       UPDATED
my-app        ● Ready   main         2m ago
api-service   ● Ready   feature/auth 1h ago
worker        ○ Sleep   main         3d ago

# ✓ 带颜色的列表（仅关键列着色）
  my-app          ● Ready    main          2m ago
  api-service     ● Ready    feature/auth  1h ago
  worker          ○ Sleep    main          3d ago
```

**表格规则：**
- 不使用 ASCII 边框（`+---+` 风格）
- 列间距：2 个空格
- 表头使用 Dim 或 Bold 样式
- 数据行无前缀装饰
- 状态列使用语义色（绿 = Ready, 灰 = Sleep, 红 = Error）
- 超过 20 行考虑分页（使用 pager）

---

## 3. Layout Style — 布局风格

### 3.1 输出结构（Header / Body / Footer）

```
┌─ Header（可选 ─ 仅需时显示）
│  Deploying my-app to production...
│
├─ Body
│  ✓ Build completed (12.3s)
│  ✓ Functions bundled (3 functions, 245KB)
│  ✓ Edge config synced
│
└─ Footer（可选 ─ 后续动作提示）
   → https://my-app.vercel.app
   Run `vercel inspect` for details
```

**分区规则：**
- **Header**：操作描述，使用 Bold。长时间操作带 Spinner。
- **Body**：步骤列表或数据表格。每行一个信息单元。
- **Footer**：结果 URL、下一步建议命令（Dim 色）。
- 区块间用 1 个空行分隔，不使用分隔线。

### 3.2 对齐方式

```
# 左对齐（默认 ─ 所有文本内容）
✓ Database created
✓ Branch "staging" created

# 右对齐（数值列 ─ 表格内）
NAME          SIZE     ROWS
users         2.4 MB   12,847
orders       18.1 MB  142,003

# 列对齐（键值对 ─ Label:Value 结构）
  Name:        my-database
  Region:      us-east-1
  Plan:        Scaler Pro
  Created:     2024-01-15
```

**键值对对齐规则：**
- Label 右对齐到最长 label 宽度
- Value 左对齐，Label 和 Value 间用 2 个空格（或对齐到固定列）
- Label 使用 Dim 或 Bold 样式

### 3.3 间距与留白

```
# 段落间距：1 个空行
✓ Build completed in 12.3s

  3 functions deployed:
  → /api/users     (12KB)
  → /api/orders    (8KB)
  → /api/products  (15KB)

# 缩进：2 个空格一级（不使用 Tab）
◆ Select a project
  ▸ my-app
    api-service
    worker

# 嵌套列表
  my-app
    ├── api/
    │   ├── users.ts
    │   └── orders.ts
    └── pages/
        └── index.tsx
```

### 3.4 交互式组件布局

**文本输入（Text Input）：**
```
◆ What is your project name?
│ my-new-project█
└
```

**单选（Select）：**
```
◆ Select environment
│ ▸ Production
│   Preview
│   Development
└
```

**多选（Multi-Select）：**
```
◆ Select regions (space to toggle)
│ ◼ us-east-1
│ ◻ us-west-2
│ ◼ eu-west-1
└
```

**确认（Confirm）：**
```
◆ Deploy to production? (y/N)
```

**危险操作确认：**
```
✗ This will delete database "prod-db" and all its data.
  Type "prod-db" to confirm: █
```

**交互组件通用规则：**
- 使用 `◆` 标记交互提示点
- 使用 `│` 竖线连接选项区域
- 使用 `└` 闭合组件底部
- 活跃选项使用 Primary 色 + `▸` 前缀
- 确认后回显选择：`◇ Environment: Production`（Dim 色）

### 3.5 状态反馈布局

**Loading / Spinner：**
```
⠋ Connecting to database...          ← Spinner 位于行首
```

**Spinner → 完成态转换：**
```
⠋ Building...                        ← 进行中
✓ Build completed (12.3s)             ← 完成（替换 Spinner）
✗ Build failed                        ← 失败（替换 Spinner）
```

**进度条（Progress Bar）：**
```
Uploading  ████████████░░░░░░░░  62%  1.2MB/1.9MB
```

**多步骤进度：**
```
✓ Installing dependencies
✓ Building project
⠹ Deploying functions (2/5)
○ Assigning domains
○ Verifying deployment
```

**错误信息：**
```
✗ Error: Database "my-db" not found

  The database may have been deleted or you may not have access.

  Run `pscale database list` to see available databases.
  See: https://docs.example.com/databases
```

---

## 4. Command Structure — 命令结构设计

### 4.1 命令层级

```
cli <noun> <verb> [args] [flags]

# 示例
pscale database create my-db --region us-east-1
vercel deploy --prod
stripe listen --forward-to localhost:3000
railway environment new staging
```

**层级规范：**
- **顶级命令**：资源名词（`database`、`branch`、`deploy`）
- **子命令**：动作动词（`create`、`list`、`delete`、`show`）
- **参数**：位置参数用于核心对象（`my-db`）
- **Flags**：可选配置（`--region`、`--format`）

**常用子命令动词标准化：**

| 动词       | 用途                 | 别名         |
| ---------- | -------------------- | ------------ |
| `list`     | 列出资源             | `ls`         |
| `create`   | 创建资源             | `new`, `add` |
| `delete`   | 删除资源             | `rm`         |
| `show`     | 查看详情             | `get`, `info`|
| `update`   | 更新资源             | `set`, `edit`|

### 4.2 标准全局 Flags

| Flag             | 用途                         |
| ---------------- | ---------------------------- |
| `-h, --help`     | 显示帮助                     |
| `-v, --version`  | 显示版本                     |
| `--json`         | JSON 格式输出                |
| `--no-color`     | 禁用颜色输出                 |
| `--no-input`     | 禁用交互式提示               |
| `-q, --quiet`    | 最小化输出                   |
| `--verbose`      | 详细输出                     |
| `--debug`        | 调试输出                     |
| `-f, --force`    | 跳过确认                     |
| `--format`       | 输出格式（human/json/csv）   |

### 4.3 帮助文档排版

```
Usage: pscale database <command>

Manage your PlanetScale databases.

Commands:
  create       Create a new database
  delete       Delete a database
  list         List all databases
  show         Show database details
  dump         Export database schema

Flags:
  -h, --help             Show help
      --org <name>       Organization name
  -f, --format <type>    Output format (human, json, csv)

Examples:
  $ pscale database create my-db --region us-east-1
  $ pscale database list --format json
  $ pscale database show my-db

Learn more: https://docs.planetscale.com/reference/database
```

**帮助文档规则：**
- 结构：`Usage → Description → Commands → Flags → Examples → Link`
- Commands 和 Flags 列对齐
- Examples 使用 `$` 前缀
- 最常用的命令/flag 排在前面
- 在子命令帮助中不重复显示全局 flags

### 4.4 错误信息结构化展示

```
# 结构：Symbol + Error Type + Message
✗ Error: Authentication failed

  Your API token has expired or is invalid.

  To fix this:
    1. Run `pscale auth login` to re-authenticate
    2. Or set PLANETSCALE_TOKEN environment variable

  If the issue persists, visit:
  https://docs.planetscale.com/reference/auth

# 验证错误（多项）
✗ Validation failed:

  • --region is required
  • --name must be 3-63 characters
  • --name can only contain lowercase letters, numbers, and hyphens

# 简单错误（单行）
✗ Branch "staging" already exists
```

**错误信息设计原则：**
1. **说人话** — 避免内部错误码或堆栈（除非 `--debug`）
2. **可操作** — 每个错误都给出修复建议
3. **分层** — 先展示错误，再展示原因，最后给出修复路径
4. **关键信息放最后** — 用户的视线自然停在输出末尾

---

## 5. Design Tokens — 设计令牌汇总

```typescript
const DesignTokens = {
  // 间距
  indent: 2,              // 缩进空格数
  columnGap: 2,            // 表格列间距
  sectionGap: 1,           // 段落间空行数

  // 宽度
  maxContentWidth: 80,     // 主内容最大宽度
  maxTableWidth: 120,      // 表格最大宽度
  minLabelWidth: 12,       // 键值对 Label 最小宽度

  // Spinner
  spinnerFrames: ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'],
  spinnerInterval: 80,     // ms

  // 符号
  symbols: {
    success:   '✓',
    error:     '✗',
    warning:   '⚠',
    info:      'ℹ',
    active:    '●',
    inactive:  '○',
    pointer:   '▸',
    dash:      '─',
    pipe:      '│',
    corner:    '└',
    prompt:    '◆',
    done:      '◇',
    arrow:     '→',
    selected:  '◼',
    unselected:'◻',
  },

  // 颜色（True Color）
  colors: {
    primary:  '#7C3AED',
    success:  '#22C55E',
    warning:  '#EAB308',
    error:    '#EF4444',
    info:     '#3B82F6',
    muted:    '#6B7280',
    surface:  '#1F2937',
  },
}
```

---

## 6. Quick Reference — 速查表

### 输出模式决策树

```
stdout 是 TTY？
├─ Yes → 启用颜色、Spinner、交互式组件
│        检查 NO_COLOR → 如设置则禁用颜色
│        检查 TERM=dumb → 如是则降级纯文本
└─ No  → 禁用颜色、动画、交互
          输出纯文本（适配 pipe/grep/jq）
```

### 操作反馈选择

```
操作类型          反馈方式
─────────         ─────────
即时操作（<1s）   直接显示结果符号
短操作（1-10s）   Spinner + 结果
长操作（>10s）    进度条 + 百分比 + ETA
多步骤操作        步骤清单（✓/⠋/○ 三态）
```

### 确认等级

```
风险等级    确认方式                     示例
────────    ────────                     ────
低          无确认 / -f 跳过              创建分支
中          Y/n 确认                     合并到 main
高          输入资源名确认               删除数据库
```

---

*本规范基于 PlanetScale CLI、Vercel CLI、Railway CLI、Stripe CLI、[Command Line Interface Guidelines](https://clig.dev)、[Charm](https://charm.sh) 生态的设计模式提炼而成。*

---

## 7. Web Frontend CLI Mode — Web 前端 CLI 模式规范

> 本章定义 CLI 模式在 Web 前端（React + Tailwind CSS）中的实现规范。
> 设计灵感来自 PlanetScale CLI 工具页面的紧凑优雅风格——高信息密度、克制的色彩运用、等宽字体贯穿始终。
> 核心目标：**在浏览器中还原终端的专注感与效率，同时利用 Web 的交互能力增强体验。**

### 7.1 CSS 设计令牌映射

§5 中定义的 DesignTokens 通过 CSS 自定义属性映射到 Web 前端。所有 CLI 模式的样式均基于这些变量，确保与终端规范的一致性。

**根级变量（`.cli-session` 作用域）：**

```css
/* web/src/index.css */
.cli-session {
  --cli-font: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --cli-prompt-color: #3b82f6;        /* 用户输入提示符 ❯ 的颜色 — 对应 Info 蓝 */
  --cli-tool-icon-color: #8b5cf6;     /* 工具调用前缀符号颜色 — 对应 Primary 紫 */
  --cli-panel-bg: var(--social-muted); /* 结果面板背景 */
}
```

**深色主题覆盖（`[data-theme="dark"]`）：**

```css
[data-theme="dark"] .cli-session {
  --cli-prompt-color: #60a5fa;        /* 深色下提亮蓝色以保证对比度 */
  --cli-tool-icon-color: #a78bfa;     /* 深色下提亮紫色 */
}
```

**与 §5 DesignTokens 的映射关系：**

| §5 DesignToken           | CSS 自定义属性              | 说明                         |
| ------------------------ | --------------------------- | ---------------------------- |
| `colors.info` (#3B82F6)  | `--cli-prompt-color`        | 浅色主题下的提示符颜色       |
| `colors.primary` (#7C3AED)| `--cli-tool-icon-color`    | 工具前缀符号（略偏亮紫）     |
| `colors.surface` (#1F2937)| `--cli-panel-bg`           | 通过 `--social-muted` 间接引用 |
| `colors.muted` (#6B7280) | `--social-fg-muted`               | 辅助文字、完成态工具标题     |
| `colors.error` (#EF4444) | `--app-badge-error-text`   | 错误状态指示                 |
| `colors.warning` (#EAB308)| `--app-badge-warning-text` | 等待态、权限请求             |

**字体栈规范：**

CLI 模式要求全局等宽字体。通过 `.cli-session` 的级联选择器强制所有子元素继承：

```css
.cli-session button,
.cli-session span,
.cli-session div,
.cli-session input,
.cli-session textarea,
.cli-session p,
.cli-session label {
  font-family: var(--cli-font);
}
```

**扩展 CSS 变量的约定：**

新增 CLI 变量时，遵循以下命名规则：
- 前缀：`--cli-`
- 语义命名：`--cli-{角色}-{属性}`（如 `--cli-result-border`、`--cli-spinner-color`）
- 必须同时定义浅色（默认）和深色（`[data-theme="dark"]`）值
- 优先复用 `--app-*` 系列变量作为值，减少硬编码色值

### 7.2 组件设计模式

CLI 模式的核心组件位于 `web/src/components/AssistantChat/cli/`，通过 `CliBlockRenderer` 统一路由渲染。

#### 7.2.1 块类型路由（CliBlockRenderer）

```tsx
// web/src/components/AssistantChat/cli/CliBlockRenderer.tsx
switch (block.kind) {
    case 'user-text':       → <CliUserBlock />
    case 'agent-text':      → <CliAgentTextBlock />
    case 'agent-reasoning': → <CliReasoningBlock />
    case 'tool-call':       → <CliToolBlock />
    case 'cli-output':      → <CliCliOutputBlock />
    case 'agent-event':     → <CliEventBlock />
}
```

#### 7.2.2 用户输入块（CliUserBlock）

**视觉结构：** 左边框（2px）+ `❯` 提示符 + 用户文本

```
┌─ border-l-2 (--cli-prompt-color)
│ ❯ 用户输入的文本内容
└─
```

**样式规范：**

```tsx
<div className="border-l-2 border-[var(--cli-prompt-color)] pl-3 py-1">
    <span className="text-[var(--cli-prompt-color)] mr-2 select-none">❯</span>
    <span className="text-[var(--social-fg)] whitespace-pre-wrap break-words">{text}</span>
</div>
```

- 左边框宽度：`2px`，颜色跟随 `--cli-prompt-color`
- 提示符 `❯`：不可选中（`select-none`），与文本间距 `mr-2`（8px）
- 附件显示为 `[filename]` 标签，使用 `--social-fg-muted` 颜色，`text-xs` 字号

#### 7.2.3 工具调用块（CliToolBlock）

**单行紧凑布局：** `[状态图标] [分类前缀] [工具标题] [副标题…] [耗时]`

**分类前缀符号表：**

| 前缀 | 工具类别                        | 匹配规则                              |
| ---- | ------------------------------- | ------------------------------------- |
| `$`  | Shell / 命令执行                | `bash`, `execute`, `*shell*`, `*terminal*` |
| `→`  | 文件读取                        | `read`, `glob`, `grep`, `ls`          |
| `←`  | 文件写入                        | `write`, `edit`, `multiedit`, `notebook_edit`, `*patch*` |
| `◎`  | 网络请求                        | `webfetch`, `websearch`               |
| `▸`  | 任务/消息                       | `task`, `sendmessage`, `teamcreate`   |
| `⚡` | MCP 工具                        | `mcp__*` 前缀                         |
| `•`  | 其他                            | 默认回退                              |

前缀符号颜色统一使用 `--cli-tool-icon-color`。

**状态指示器：**

| 符号/组件    | 状态     | 颜色                                 |
| ------------ | -------- | ------------------------------------ |
| `<Spinner/>` | 运行中   | `--social-fg-muted`                         |
| `✓`          | 完成     | `--social-fg-muted` + `opacity-60`（muted） |
| `✗`          | 错误     | `--app-badge-error-text`（红色）     |
| `○`          | 等待     | `--app-badge-warning-text`（黄色）   |

**交互行为：**
- 整行可点击，点击展开/折叠结果面板
- 有结果时 hover 显示 `bg-[var(--social-muted)]`
- 无结果时 `cursor-default`，无 hover 效果
- 耗时显示在最右侧，`ml-auto`，`opacity-50`

#### 7.2.4 结果面板（ResultPanel）

**视觉结构：** 左边框 + 缩进 + 可折叠 + 截断

```
│ ← border-l (--social-divider), ml-5, pl-3
│  结果文本（最多 20 行）
│  show more…  ← 超出时显示展开链接
```

**样式规范：**

```tsx
<div className="ml-5 mt-0.5 border-l border-[var(--social-divider)] pl-3 text-xs text-[var(--social-fg-muted)]">
    <pre className="whitespace-pre-wrap break-words leading-relaxed">
        {displayText}
    </pre>
</div>
```

- 缩进：`ml-5`（20px），与工具行的状态图标对齐
- 左边框：`1px`，使用 `--social-divider` 颜色
- 字号：`text-xs`（12px），低于正文层级
- 最大行数：**20 行**（`MAX_RESULT_LINES`），超出显示 "show more…" 链接
- 错误结果额外显示红色 "error" 标签

#### 7.2.5 权限组件（CliPermission / CliBtn）

**CliBtn — 紧凑按钮：**

三种色调（tone）：

| Tone      | 文字色          | 边框色               | Hover 背景            | 用途               |
| --------- | --------------- | -------------------- | --------------------- | ------------------ |
| `allow`   | `--app-badge-success-text` | `--app-badge-success-border` | `--app-badge-success-bg` | 允许、提交 |
| `deny`    | `--social-danger` | `--app-badge-error-border` | `--app-badge-error-bg` | 拒绝、停止 |
| `neutral` | `--social-fg` | `--social-border` | `--social-hover` | 会话级允许等 |

CliBtn 包装的是 `Button`（`variant="outline" size="sm"`），只换色调，不手写 `<button>`：

```tsx
<Button variant="outline" size="sm" className={cn('h-9 gap-1 px-3 text-footnote', HIT_AREA_CLASS, color)}>
    {loading && <Spinner size="sm" label={null} className="h-3 w-3 text-current" />}
    {label}
</Button>
```

**权限请求布局：**

```
     permission required  [allow] [allow (session)] [deny]
```

- 缩进 `ml-5`，与结果面板对齐
- 按钮间距 `gap-1.5`
- 警告文字使用 `--app-badge-warning-text`

#### 7.2.6 交互问答（AskUserQuestion / RequestUserInput）

**单选风格：** `● 选中` / `○ 未选中`
**多选风格：** `☑ 选中` / `☐ 未选中`

选项渲染为紧凑按钮组：

```tsx
<button className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs
    transition-colors ${selected
        ? 'border-[var(--social-fg)] bg-[var(--social-fg)]/10 text-[var(--social-fg)]'
        : 'border-[var(--social-border)] text-[var(--social-fg-muted)] hover:text-[var(--social-fg)]'
    }`}>
    {multiSelect ? (selected ? '☑ ' : '☐ ') : (selected ? '● ' : '○ ')}
    {label}
</button>
```

- 选中态：`--social-fg` 色边框 + 10% 透明背景
- 未选中态：`--social-border` + `--social-fg-muted` 文字
- 文本输入框：透明背景、`max-w-md`、`focus:border-[var(--social-fg)]`
- "other" 选项始终附加在选项列表末尾

#### 7.2.7 推理块（CliReasoningBlock）

使用 `<details>` 原生折叠：

```tsx
<details className="py-0.5 group">
    <summary className="text-[var(--social-fg-muted)] italic text-xs cursor-pointer select-none
        hover:text-[var(--social-fg)] transition-colors">
        thinking…
    </summary>
    <div className="text-[var(--social-fg-muted)] italic text-xs pl-4 border-l border-[var(--social-divider)]
        mt-1 whitespace-pre-wrap break-words">
        {text}
    </div>
</details>
```

- 默认折叠，summary 显示 "thinking…"
- 展开内容使用左边框 + 缩进，斜体 + hint 颜色

#### 7.2.8 事件块（CliEventBlock）

系统事件以单行斜体显示，前缀 `—`：

```
— completed in 2.3s
— rate limited (token): retrying
```

- 普通事件：`--social-fg-muted` 颜色
- 警告事件（rate-limit、limit-reached、api-error）：`--app-badge-warning-text`
- 静默事件（ready、title-changed、switch、message）：不渲染

### 7.3 排版与间距

#### 7.3.1 基础排版参数

| 参数       | 值                                              | 对应 CSS                    |
| ---------- | ----------------------------------------------- | --------------------------- |
| 字体       | `var(--cli-font)`（等宽字体栈）                  | `.cli-thread { font-family }` |
| 基础字号   | `0.8125rem`    | `.cli-thread { font-size }`  |
| 行高       | `1.6`                                           | `.cli-thread { line-height }` |
| 文本溢出   | `break-word` + `overflow-wrap: break-word`       | `.cli-thread`               |

`0.8125rem` = 13px（在默认 16px 根字号下），比常规 UI 字号略小，营造终端的紧凑感。全局字号设置会改 `html` 的字号，rem 自动跟着缩放；不要再乘 `--app-font-scale`，否则会缩放两次。

#### 7.3.2 间距系统

| 位置             | 间距                  | Tailwind 类           | 像素值      |
| ---------------- | --------------------- | --------------------- | ----------- |
| 块间距（垂直）   | `space-y-0.5`         | `.space-y-0.5`        | 2px         |
| 块内上下间距     | `py-0.5`              | `.py-0.5`             | 2px (上+下) |
| 线程容器内边距   | `px-4 py-3`           | `.cli-thread`         | 16px / 12px |
| 结果面板缩进     | `ml-5 pl-3`           | `ResultPanel`         | 20px + 12px |
| 子任务嵌套缩进   | `ml-5 pl-2`           | 嵌套 children         | 20px + 8px  |
| 权限栏缩进       | `ml-5`                | `CliPermission`       | 20px        |

#### 7.3.3 与终端 80 列限制的关系

终端 CLI 规范（§1.2）要求主内容不超过 80 列。Web 前端通过以下方式适配：

- **线程容器**：`max-w-content`（全局内容最大宽度），由 Tailwind 配置定义
- **文本溢出**：`whitespace-pre-wrap` + `break-words`，长行自动换行而非截断
- **代码块**：`overflow-x-auto`，水平滚动而非换行
- **工具行**：`truncate`（`text-overflow: ellipsis`）截断长路径/副标题

Web 前端不强制 80 列硬限制，而是通过 `max-w-content` 和响应式布局自适应。

### 7.4 Markdown 渲染定制

CLI 模式使用 `ReactMarkdown` + `remarkGfm`，通过自定义组件覆盖实现紧凑样式。

#### 7.4.1 代码块

**行内代码：**
```tsx
<code className="break-words rounded-md bg-[var(--app-inline-code-bg)] px-[0.3em] py-[0.1em] text-[0.9em]">
```

**围栏代码块（带语法高亮）：**
```tsx
<div className="my-1 min-w-0 w-full max-w-full overflow-hidden rounded-md border border-[var(--social-border)]">
    {/* 头部：语言标签 + 复制按钮 */}
    <div className="flex items-center justify-between bg-[var(--app-code-bg)] px-2 py-0.5">
        <span className="text-xs text-[var(--social-fg-muted)]">{language}</span>
        <button>...</button>  {/* 复制按钮 */}
    </div>
    {/* 代码体：Shiki 高亮 */}
    <pre className="shiki m-0 w-max min-w-full overflow-x-auto bg-[var(--app-code-bg)] p-2 text-sm font-mono">
        <code className="block">{highlighted}</code>
    </pre>
</div>
```

- 上下间距 `my-1`（4px），比普通模式更紧凑
- 头部高度极小：`py-0.5`
- 代码体允许水平滚动：`overflow-x-auto`

#### 7.4.2 段落、列表、引用、表格

| 元素     | CLI 模式样式                                                          |
| -------- | --------------------------------------------------------------------- |
| `<p>`    | `mb-1 leading-relaxed break-words`，底部间距仅 4px                     |
| `<ul>`   | `list-disc pl-5 my-0.5`，紧凑列表间距                                 |
| `<ol>`   | `list-decimal pl-5 my-0.5`                                            |
| `<li>`   | `my-0`，无额外间距                                                     |
| `<blockquote>` | `border-l-4 border-[var(--social-fg-muted)] pl-3 opacity-85`           |
| `<table>`| 包裹在 `overflow-x-auto` 容器中，`w-full border-collapse`             |
| `<th>`   | `border border-[var(--social-border)] px-2 py-1 font-semibold bg-[var(--social-muted)]` |
| `<td>`   | `border border-[var(--social-border)] px-2 py-1`                         |
| `<hr>`   | `border-[var(--social-divider)] my-1`                                     |
| `<a>`    | `text-[var(--social-fg)] underline`                                     |

CLI 模式下 Markdown 继承线程的等宽字体和字号：

```css
.cli-thread .aui-md {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

.cli-thread .aui-md p { margin-bottom: 0.25rem; }
.cli-thread .aui-md h1, ... h6 {
  font-family: inherit;
  margin-top: 0.5rem;
  margin-bottom: 0.25rem;
}
.cli-thread .aui-md ul, .cli-thread .aui-md ol {
  padding-left: 1.75rem;
  margin-bottom: 0.25rem;
  list-style-position: outside;
}
```

### 7.5 输入区（HappyComposer CLI 模式）

当 `cliMode={true}` 时，Composer 应用终端风格：

**视觉变化：**

```
┌─────────────────────────────────────┐  ← 直角边框（rounded-md border）
│ ❯ 输入文本…                         │
└─────────────────────────────────────┘
```

对比普通模式的圆角药丸形（`rounded-[20px]`），CLI 模式使用：
- 容器：`rounded-md border border-[var(--social-border)] bg-transparent`
- 内边距：`px-2 py-1.5`（比普通模式的 `px-4 py-3` 更紧凑）
- 提示符：`❯`，颜色 `--cli-prompt-color`，`font-semibold`，位于输入框左侧
- 字体：`font-mono text-[0.8125rem]`

```css
.cli-composer {
  font-family: var(--cli-font);
  font-size: 0.8125rem;
}
.cli-composer .flex.items-center.justify-between {
  padding-top: 0.125rem;
  padding-bottom: 0.25rem;
}
```

### 7.6 模式切换（useChatViewMode）

三种视图模式通过 `useChatViewMode` hook 管理：

| 模式     | 存储值    | 渲染组件       | 特点                       |
| -------- | --------- | -------------- | -------------------------- |
| `normal` | `normal`  | `HappyThread`  | 完整卡片式聊天 UI           |
| `brief`  | `brief`   | `BriefTurnList`| 压缩的回合列表              |
| `cli`    | `cli`     | `CliThread`    | 终端风格，等宽字体，高密度   |

- 持久化到 `localStorage`（key: `hapi-chat-view-mode-v1`）
- 切换时容器自动添加/移除 `.cli-session` class
- CLI 模式下 Composer 自动切换为终端风格

### 7.7 实践操作指南

#### 7.7.1 如何新增一个 CLI 块类型

**步骤 1：定义块类型**

在 `web/src/chat/types.ts` 中添加新的块类型定义：

```typescript
export type MyNewBlock = {
    kind: 'my-new-block'
    id: string
    // ... 自定义字段
}

// 将其加入 ChatBlock 联合类型
export type ChatBlock = ... | MyNewBlock
```

**步骤 2：创建组件**

在 `web/src/components/AssistantChat/cli/` 下创建组件文件：

```tsx
// web/src/components/AssistantChat/cli/CliMyNewBlock.tsx
import { memo } from 'react'
import type { MyNewBlock } from '@/chat/types'

export const CliMyNewBlock = memo(function CliMyNewBlock(props: { block: MyNewBlock }) {
    return (
        <div className="py-0.5 text-xs text-[var(--social-fg-muted)]">
            {/* 遵循 py-0.5 块间距、text-xs 辅助字号的约定 */}
        </div>
    )
})
```

**步骤 3：注册到 CliBlockRenderer**

```tsx
// web/src/components/AssistantChat/cli/CliBlockRenderer.tsx
import { CliMyNewBlock } from './CliMyNewBlock'

// 在 switch 中添加 case：
case 'my-new-block':
    return <CliMyNewBlock block={block} />
```

**命名约定：**
- 文件名：`Cli{BlockName}.tsx`
- 组件名：`Cli{BlockName}`
- 使用 `memo()` 包裹避免不必要的重渲染

#### 7.7.2 CSS 变量扩展约定

新增 CLI 相关 CSS 变量时：

1. **在 `.cli-session` 中定义**默认值（浅色主题）
2. **在 `[data-theme="dark"] .cli-session` 中**定义深色覆盖
3. 命名遵循 `--cli-{语义角色}-{属性}` 模式
4. 优先引用已有的 `--app-*` 变量

```css
/* 示例：新增结果面板边框色 */
.cli-session {
  --cli-result-border: var(--social-divider);
}
[data-theme="dark"] .cli-session {
  --cli-result-border: var(--social-divider);  /* 深色下可使用不同值 */
}
```

#### 7.7.3 深色/浅色主题测试清单

新增或修改 CLI 组件后，需要验证以下项目：

- [ ] **提示符颜色**：浅色 `#3b82f6` → 深色 `#60a5fa`，对比度 ≥ 4.5:1
- [ ] **工具前缀色**：浅色 `#8b5cf6` → 深色 `#a78bfa`，可辨识
- [ ] **完成态 `✓`**：muted（`opacity-60`），不应抢夺视觉焦点
- [ ] **错误态 `✗`**：红色清晰可见，与正常文字区分明显
- [ ] **等待态 `○`**：黄色/warning 色，与运行态 spinner 可区分
- [ ] **结果面板**：左边框可见但不突兀，文字与背景对比度充足
- [ ] **代码块**：`--app-code-bg` 在两个主题下都与周围区域有区分
- [ ] **选中态按钮**：`--social-fg` 色的 10% 透明背景在两个主题下都可见
- [ ] **输入框 focus**：边框色变化明显，可感知焦点状态
- [ ] **Markdown 表格**：边框色在深色背景下可见

### 7.8 设计原则总结

| 原则                   | 实现方式                                                   |
| ---------------------- | ---------------------------------------------------------- |
| **信息密度优先**       | 块间距仅 2px，辅助信息用 opacity 降级而非隐藏               |
| **渐进式披露**         | 结果面板默认折叠，20 行截断，点击展开                       |
| **等宽字体贯穿**       | `.cli-session` 级联强制所有子元素继承 `--cli-font`          |
| **色彩克制**           | 仅状态指示器和关键标记着色，正文使用 `--social-fg`/`--social-fg-muted` |
| **终端隐喻一致**       | `❯` 提示符、`$` `→` `←` 前缀、`✓` `✗` `○` 状态符号        |
| **Web 增强**           | 可点击展开、hover 效果、Shiki 语法高亮、内联权限操作         |
