# haqi CLI

Run Claude Code, Codex, Cursor Agent, Gemini, or OpenCode sessions from your terminal and control them remotely through the haqi hub.

## What it does

- Starts Claude Code sessions and registers them with haqi-hub.
- Starts Codex mode for OpenAI-based sessions.
- Starts Cursor Agent mode for Cursor CLI sessions.
- Starts Gemini mode via ACP (Anthropic Code Plugins).
- Starts OpenCode mode via ACP and its plugin hook system.
- Provides an MCP stdio bridge for external tools.
- Manages a background runner for long-running sessions.
- Includes diagnostics and auth helpers.

## Typical flow

1. Start the hub and set env vars (see ../hub/README.md).
2. Set the same CLI_API_TOKEN on this machine or run `haqi auth login`.
3. Run `haqi` to start a session.
4. Use the web app or Telegram Mini App to monitor and control.

## Commands

### Session commands

- `haqi` - Start a Claude Code session (passes through Claude CLI flags). See `src/index.ts`.
- `haqi codex` - Start Codex mode. See `src/codex/runCodex.ts`.
- `haqi codex resume <sessionId>` - Resume existing Codex session.
- `haqi cursor` - Start Cursor Agent mode. See `src/cursor/runCursor.ts`.
  Supports `haqi cursor resume <chatId>`, `haqi cursor --continue`, `--mode plan|ask`, `--yolo`, `--model`.
  Local and remote modes supported; remote uses `agent -p` with stream-json.
- `haqi gemini` - Start Gemini mode via ACP. See `src/agent/runners/runAgentSession.ts`.
  Note: Gemini runs in remote mode only; it waits for messages from the hub UI/Telegram.
- `haqi opencode` - Start OpenCode mode via ACP. See `src/opencode/runOpencode.ts`.
  Note: OpenCode supports local and remote modes; local mode streams via OpenCode plugins.

### Authentication

- `haqi auth status` - Show authentication configuration and token source.
- `haqi auth login` - Interactively enter and save CLI_API_TOKEN.
- `haqi auth logout` - Clear saved credentials.

See `src/commands/auth.ts`.

### Runner management

- `haqi runner start` - Start runner as detached process.
- `haqi runner stop` - Stop runner gracefully.
- `haqi runner status` - Show runner diagnostics.
- `haqi runner list` - List active sessions managed by runner.
- `haqi runner stop-session <sessionId>` - Terminate specific session.
- `haqi runner logs` - Print path to latest runner log file.

See `src/runner/run.ts`.

### Diagnostics

- `haqi doctor` - Show full diagnostics (version, runner status, logs, processes).
- `haqi doctor clean` - Kill runaway HAQI processes.

See `src/ui/doctor.ts`.

### Other

- `haqi mcp` - Start MCP stdio bridge. See `src/codex/happyMcpStdioBridge.ts`.
- `haqi hub` - Start the bundled hub (single binary workflow).
- `haqi server` - Alias for `haqi hub`.

## Configuration

See `src/configuration.ts` for all options.

### Required

- `CLI_API_TOKEN` - Shared secret; must match the hub. Can be set via env or `~/.hapi/settings.json` (env wins).
- `HAPI_API_URL` - Hub base URL (default: http://localhost:3006).

### Optional

- `HAPI_HOME` - Config/data directory (default: ~/.hapi).
- `HAPI_EXPERIMENTAL` - Enable experimental features (true/1/yes).
- `HAPI_CLAUDE_PATH` - Path to a specific `claude` executable.
- `HAPI_HTTP_MCP_URL` - Default MCP target for `haqi mcp`.
- `HAPI_CODEX_ENABLE_REPORT_PROMPT` - Enable the extra Codex developer prompt section that teaches report MCP usage, including default report share creation and public share link format like `<report-public-base-url>/share/r/<token>` (default: disabled).
- `HAPI_GEMINI_PROMPT_TIMEOUT_MS` - Gemini ACP prompt timeout in milliseconds (default: 1800000; set `0` or negative to disable).

### Runner

- `HAPI_RUNNER_HEARTBEAT_INTERVAL` - Heartbeat interval in ms (default: 60000).
- `HAPI_RUNNER_HTTP_TIMEOUT` - HTTP timeout for runner control in ms (default: 10000).

### Worktree (set by runner)

- `HAPI_WORKTREE_BASE_PATH` - Base repository path.
- `HAPI_WORKTREE_BRANCH` - Current branch name.
- `HAPI_WORKTREE_NAME` - Worktree name.
- `HAPI_WORKTREE_PATH` - Full worktree path.
- `HAPI_WORKTREE_CREATED_AT` - Creation timestamp (ms).

## Storage

Data is stored in `~/.hapi/` (or `$HAPI_HOME`):

- `settings.json` - User settings (machineId, token, onboarding flag). See `src/persistence.ts`.
- `runner.state.json` - Runner state (pid, port, version, heartbeat).
- `logs/` - Log files.

## Requirements

- Claude CLI installed and logged in (`claude` on PATH).
- Cursor Agent CLI installed (`agent` on PATH) for `hapi cursor`. Install: `curl https://cursor.com/install -fsS | bash` (macOS/Linux), `irm 'https://cursor.com/install?win32=true' | iex` (Windows).
- OpenCode CLI installed (`opencode` on PATH).
- Bun for building from source.

## Build from source

From the repo root:

```bash
bun install
bun run build:cli
(cd cli && bun run build:exe)
```

For an all-in-one binary that also embeds the web app:

```bash
bun run build:single-exe
```

## Deploy locally after build (Linux)

```bash
cp -a ~/.local/bin/haqi ~/.local/bin/haqi.bak.$(date +%Y%m%d-%H%M%S)
install -m 755 ./cli/dist-exe/bun-linux-x64/hapi ~/.local/bin/haqi
haqi runner stop || true
haqi runner start
```

## Source structure

- `src/api/` - Bot communication (Socket.IO + REST).
- `src/claude/` - Claude Code integration.
- `src/codex/` - Codex mode integration.
- `src/cursor/` - Cursor Agent integration.
- `src/agent/` - Multi-agent support (Gemini via ACP).
- `src/opencode/` - OpenCode ACP + hook integration.
- `src/runner/` - Background service.
- `src/commands/` - CLI command handlers.
- `src/ui/` - User interface and diagnostics.
- `src/modules/` - Tool implementations (ripgrep, difftastic, git).

## Related docs

- `../hub/README.md`
- `../web/README.md`

### Claude 多账号接管实验版（本地隔离）

当前功能默认关闭。仅在确认使用的是隔离测试账号时开启：

```bash
export HAPI_CLAUDE_ACCOUNT_HANDOFF=1
mkdir -p "$HAPI_HOME/claude-accounts/work" "$HAPI_HOME/claude-accounts/personal"
CLAUDE_CONFIG_DIR="$HAPI_HOME/claude-accounts/work" claude   # 分别完成登录
CLAUDE_CONFIG_DIR="$HAPI_HOME/claude-accounts/personal" claude
cat > "$HAPI_HOME/claude-accounts.json" <<'JSON'
{"version":1,"initialAccount":"work","autoSwitch":false,"profiles":[
  {"id":"work","email":"work@example.com","configDir":"/绝对路径/.hapi/claude-accounts/work","trustGroup":"同一授权组"},
  {"id":"personal","email":"personal@example.com","configDir":"/绝对路径/.hapi/claude-accounts/personal","trustGroup":"同一授权组"}
]}
JSON
```

实验版仅支持 HAQI remote 会话；会话中可用 `/account list`、`/account use <id>`、`/account auto on|off`。切换只在回合和工具安全完成后发生；通过 `context_handoff` 交接，HAQI session 保持不变。存在未完成工具、后台 Agent、过长历史或无法核验身份时 fail-closed，不自动重放。

不要把真实邮箱、token 或配置目录提交到仓库；账号 JSON 只存元数据，凭据由 Claude 的隔离配置目录管理。
