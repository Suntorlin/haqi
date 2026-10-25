# HAQI

Run official Claude Code / Codex / Gemini / OpenCode sessions locally and control them remotely through a Web / PWA / Telegram Mini App.

> **Why HAQI?** HAQI is a local-first alternative to Happy. See [Why Not Happy?](docs/guide/why-hapi.md) for the key differences.

## Highlights

These three features are new. They work end to end.

### Tasks

Write what you want in one message. HAQI runs the work and asks you only when it needs you.

1. A planner session reads your repository and your memory. It writes a goal, 3 to 6 acceptance criteria, and up to 3 questions.
2. You tick, edit, or add criteria. You answer the questions.
3. A lead session splits the work into up to 5 subtasks. Up to 3 subtasks run at the same time. Each subtask runs in its own git worktree.
4. When an agent needs a decision, you get 2 to 4 options. Each option shows its gain and its cost.
5. A merge session joins the branches into one local branch. HAQI does not push.
6. A reviewer session checks each acceptance criterion and gives evidence. A failed criterion starts a fix round. The limit is 2 review rounds.
7. You get one report with a share link. You accept the report, or you write what to change.

Tasks use Claude Code. All the sessions of one task run on one machine.

### Scheduled tasks

Scheduled tasks are like the scheduled tasks of Claude Desktop. The difference: the hub keeps the clock, so no app must stay open.

- Write a prompt, or give a file of instructions. Each run reads the file again.
- Select the machine, the folder, the agent, the model, and the Claude account.
- Select the schedule: manual, hourly, daily, weekdays, weekly, cron, or one time. The times use your time zone.
- Each run starts a new session. The session reports its result with the `scheduled_run_done` MCP tool.
- If the hub or the machine was off at the planned time, the run starts late. It starts one time, and only if the planned time is less than 7 days old.
- A run fails when no session can start. A run also fails when its session stops without a result, or when the run passes its time limit.
- Each failure goes to push, Telegram, and a Feishu or Lark webhook.
- If a Claude account cannot start (for example, its login expired), the next account in its group starts the run.
- Agents can create and change scheduled tasks with the `schedule_create`, `schedule_list`, and `schedule_update` MCP tools.

### Multiple machines

One hub controls many machines. Each machine runs its own runner, and all runners connect to the same hub.

- Select the machine when you start a session or create a scheduled task. HAQI keeps a list of recent folders for each machine.
- Each machine has its own Claude accounts. Settings shows the accounts and the quota of each machine.
- The terminal and the file browser of a session open on the machine of that session.
- Give each machine its own home folder (`HAPI_HOME`). If two machines use a copy of one home folder, they share one machine ID, and the hub cannot tell them apart.

## Features

- **Seamless Handoff** - Work locally, switch to remote when needed, switch back anytime. No context loss, no session restart.
- **Native First** - HAQI wraps your AI agent instead of replacing it. Same terminal, same experience, same muscle memory.
- **AFK Without Stopping** - Step away from your desk? Approve AI requests from your phone with one tap.
- **Your AI, Your Choice** - Claude Code, Codex, Cursor Agent, Gemini, OpenCode—different models, one unified workflow.
- **Terminal Anywhere** - Run commands from your phone or browser, directly connected to the working machine.
- **Voice Control** - Talk to your AI agent hands-free using the built-in voice assistant.

## Branch-only features（本分支独有功能）

This branch includes a focused set of web UX upgrades. Based on the commit history, the optimizations are grouped as follows:

### 1) Session Sidebar / 项目会话侧边栏

- **Project-level quick create (+)**  
  Add a new session directly under an existing project entry.
- **Density switch (comfortable / compact)**  
  Sidebar list can switch between two densities.
- **Desktop resizable sidebar**  
  VSCode-like drag-to-resize splitter behavior.
- **Responsive sidebar behavior**
  - Desktop supports show/hide.
  - Mobile uses drawer-style interaction with improved controls.
- **Project reorder by drag-and-drop (persisted)**
  - No dedicated handle button required.
  - Desktop direct drag; mobile long-press drag.
  - Order is persisted locally.
- **Virtualized session list**
  Better performance and smoother rendering with many items.

### 2) Chat History Loading / 聊天历史加载体验

- **Stabilized auto-load scroll retention**
  Loading older messages keeps viewport position stable.
- **Reduced jump-to-top behavior across batches**
  Improved continuity while scrolling through long history.
- **History loading feedback + behavior tuning**
  Better loading-state handling during top-triggered history fetch.

### 3) Quality & Test Coverage / 质量与测试

- Added targeted tests for:
  - **history scroll retention logic**
  - **project group reorder helpers**

## Demo

https://github.com/user-attachments/assets/38230353-94c6-4dbe-9c29-b2a2cc457546

## Getting Started

```bash
npx @jasonczc/haqi hub --relay   # start hub with E2E encrypted relay
npx @jasonczc/haqi               # run claude code
```

`haqi server` remains supported as an alias.

The terminal will display a URL and QR code. Scan the QR code with your phone or open the URL to access.

> The relay uses WireGuard + TLS for end-to-end encryption. Your data is encrypted from your device to your machine.

For self-hosted options (Cloudflare Tunnel, Tailscale), see [Installation](docs/guide/installation.md)

## Docs

- [App](docs/guide/pwa.md)
- [How it Works](docs/guide/how-it-works.md)
- [Cursor Agent](docs/guide/cursor.md)
- [Voice Assistant](docs/guide/voice-assistant.md)
- [Why HAQI](docs/guide/why-hapi.md)
- [FAQ](docs/guide/faq.md)

## Build from source

```bash
bun install
bun run build:single-exe
```

## Release (tag + GitHub Actions + npm OIDC)

This repo publishes `@jasonczc/haqi` and platform packages from the `Release` workflow.

1. Bump `cli/package.json` version (must match the tag).
2. Push a tag like `v0.15.3`.
3. GitHub Actions will:
   - build all binaries,
   - publish platform npm packages + main package,
   - create a GitHub Release.

> npm must be configured with **Trusted Publishing** (OIDC) for:
> `@jasonczc/haqi`, `@jasonczc/haqi-darwin-arm64`, `@jasonczc/haqi-darwin-x64`,
> `@jasonczc/haqi-linux-arm64`, `@jasonczc/haqi-linux-x64`, `@jasonczc/haqi-win32-x64`.

## Development workflow: rebuild + deploy locally

Use this when validating frontend/CLI changes on your local running hub.

Recommended: split stable runtime vs source dev runtime.
Do not share one `HAPI_HOME` between them.

```bash
# Stable runtime (installed binary)
export HAPI_HOME="$HOME/.hapi-stable"
export HAPI_LISTEN_PORT=3006
haqi runner start
haqi hub
```

```bash
# Source dev runtime (repo)
export HAPI_HOME="$HOME/.hapi-dev"
export HAPI_LISTEN_PORT=3016
export HAPI_PUBLIC_URL="http://localhost:3016"
bun run dev
```

If you switch branches often, use branch-specific dev homes:

```bash
export HAPI_HOME="$HOME/.hapi-dev-$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
```

```bash
# 1) Build all-in-one binary (web + hub + cli)
bun run build:single-exe

# 2) Deploy binary to current user install path (Linux example)
cp -a ~/.local/bin/haqi ~/.local/bin/haqi.bak.$(date +%Y%m%d-%H%M%S)
install -m 755 ./cli/dist-exe/bun-linux-x64/hapi ~/.local/bin/haqi

# 3) Restart runtime processes
haqi runner stop || true
haqi runner start
```

Or use the helper script:

```bash
./scripts/deploy-local-binary.sh
```

Optional status check:

```bash
./scripts/hapi-local.sh status
```

## Discussion

- Telegram: [@veryhapi](https://t.me/veryhapi)

## Credits

HAQI means "哈皮" a Chinese transliteration of [Happy](https://github.com/slopus/happy). Great credit to the original project.
