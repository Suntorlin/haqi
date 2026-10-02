import { EnhancedMode, PermissionMode } from "./loop";
import { query, type QueryOptions as Options, type SDKMessage, type SDKSystemMessage, AbortError, SDKUserMessage } from '@/claude/sdk'
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { join } from 'node:path';
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { logger } from "@/lib";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { getProjectPath } from "./utils/path";
import { awaitFileExist } from "@/modules/watcher/awaitFileExist";
import { buildClaudeSystemPrompt } from "./utils/systemPrompt";
import { PermissionResult } from "./sdk/types";
import { getHapiBlobsDir } from "@/constants/uploadPaths";
import { isPureContextModeEnabled } from "@/agent/utils/haqiAgentInstructions";
import { getDefaultClaudeCodePath } from "./sdk/utils";

export async function claudeRemote(opts: {

    // Fixed parameters
    sessionId: string | null,
    path: string,
    mcpServers?: Record<string, any>,
    claudeEnvVars?: Record<string, string>,
    childEnv?: NodeJS.ProcessEnv,
    stopChildOnReturn?: boolean,
    claudeArgs?: string[],
    allowedTools: string[],
    hookSettingsPath: string,
    signal?: AbortSignal,
    canCallTool: (toolName: string, input: unknown, mode: EnhancedMode, options: { signal: AbortSignal }) => Promise<PermissionResult>,

    // Dynamic parameters
    nextMessage: (signal?: AbortSignal) => Promise<{ message: string, mode: EnhancedMode } | null>,
    onReady: () => void,
    isAborted: (toolCallId: string) => boolean,

    // Callbacks
    onSessionFound: (id: string) => void,
    onThinkingChange?: (thinking: boolean) => void,
    onMessage: (message: SDKMessage) => void,
    onCompletionEvent?: (message: string) => void,
    onSessionReset?: () => void
}) {

    // Check if session is valid
    let startFrom = opts.sessionId;
    if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path, opts.childEnv?.CLAUDE_CONFIG_DIR)) {
        startFrom = null;
    }
    
    // Extract --resume from claudeArgs if present (for first spawn)
    if (!startFrom && opts.claudeArgs) {
        for (let i = 0; i < opts.claudeArgs.length; i++) {
            if (opts.claudeArgs[i] === '--resume') {
                // Check if next arg exists and looks like a session ID
                if (i + 1 < opts.claudeArgs.length) {
                    const nextArg = opts.claudeArgs[i + 1];
                    // If next arg doesn't start with dash and contains dashes, it's likely a UUID
                    if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                        startFrom = nextArg;
                        logger.debug(`[claudeRemote] Found --resume with session ID: ${startFrom}`);
                        break;
                    } else {
                        // Just --resume without UUID - SDK doesn't support this
                        logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                        break;
                    }
                } else {
                    // --resume at end of args - SDK doesn't support this
                    logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                    break;
                }
            }
        }
    }

    // Set environment variables for Claude Code SDK
    if (opts.claudeEnvVars && !opts.childEnv) {
        Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
    }
    if (!opts.childEnv) process.env.DISABLE_AUTOUPDATER = '1';

    // Get initial message
    const initial = await opts.nextMessage();
    if (!initial) { // No initial message - exit
        return;
    }

    // Handle special commands
    const specialCommand = parseSpecialCommand(initial.message);

    // Handle /clear command
    if (specialCommand.type === 'clear') {
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Context was reset');
        }
        if (opts.onSessionReset) {
            opts.onSessionReset();
        }
        return;
    }

    // Handle /compact command
    let isCompactCommand = false;
    if (specialCommand.type === 'compact') {
        logger.debug('[claudeRemote] /compact command detected - will process as normal but with compaction behavior');
        isCompactCommand = true;
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Compaction started');
        }
    }

    const resolvedSystemPrompt = buildClaudeSystemPrompt(opts.path);
    const pureContextMode = isPureContextModeEnabled();
    const normalizedSystemPrompt = resolvedSystemPrompt.trim();

    const customSystemPrompt = pureContextMode
        ? undefined
        : (initial.mode.customSystemPrompt
            ? (normalizedSystemPrompt
                ? `${initial.mode.customSystemPrompt}\n\n${normalizedSystemPrompt}`
                : initial.mode.customSystemPrompt)
            : undefined);
    const appendSystemPrompt = pureContextMode
        ? undefined
        : (initial.mode.appendSystemPrompt
            ? (normalizedSystemPrompt
                ? `${initial.mode.appendSystemPrompt}\n\n${normalizedSystemPrompt}`
                : initial.mode.appendSystemPrompt)
            : (normalizedSystemPrompt || undefined));

    // Prepare SDK options
    let mode = initial.mode;
    const sdkOptions: Options = {
        cwd: opts.path,
        env: opts.childEnv,
        resume: startFrom ?? undefined,
        mcpServers: opts.mcpServers,
        permissionMode: initial.mode.permissionMode,
        model: initial.mode.model,
        effort: initial.mode.thinkEffort,
        fallbackModel: initial.mode.fallbackModel,
        customSystemPrompt,
        appendSystemPrompt,
        allowedTools: initial.mode.allowedTools ? initial.mode.allowedTools.concat(opts.allowedTools) : opts.allowedTools,
        disallowedTools: initial.mode.disallowedTools,
        canCallTool: (toolName: string, input: unknown, options: { signal: AbortSignal }) => opts.canCallTool(toolName, input, mode, options),
        abort: opts.signal,
        pathToClaudeCodeExecutable: getDefaultClaudeCodePath(),
        settingsPath: opts.hookSettingsPath,
        additionalDirectories: [getHapiBlobsDir()],
    }

    // Track thinking state
    let thinking = false;
    const updateThinking = (newThinking: boolean) => {
        if (thinking !== newThinking) {
            thinking = newThinking;
            logger.debug(`[claudeRemote] Thinking state changed to: ${thinking}`);
            if (opts.onThinkingChange) {
                opts.onThinkingChange(thinking);
            }
        }
    };

    // Push initial message
    let messages = new PushableAsyncIterable<SDKUserMessage>();
    messages.push({
        type: 'user',
        message: {
            role: 'user',
            content: initial.message,
        },
    });

    // Start the loop
    const response = query({
        prompt: messages,
        options: sdkOptions,
    });

    updateThinking(true);

    // Claude can start a turn on its own after a result, e.g. when a background
    // task finishes. Keep reading its output while waiting for the next user
    // message, otherwise that turn is only forwarded once the user sends
    // something, and every later reply lags one message behind.
    const iterator = response[Symbol.asyncIterator]();
    let nextSdkMessage: Promise<IteratorResult<SDKMessage>> | null = null;
    let nextUserMessage: ReturnType<typeof opts.nextMessage> | null = null;
    // Cancels a wait that is still pending when we exit, so it cannot take a
    // message meant for the next launch.
    const userWait = new AbortController();
    try {
        logger.debug(`[claudeRemote] Starting to iterate over response`);

        while (true) {
            if (!nextSdkMessage) {
                nextSdkMessage = iterator.next();
                nextSdkMessage.catch(() => {});
            }
            const event = nextUserMessage
                ? await Promise.race([
                    nextSdkMessage.then((result) => ({ source: 'sdk' as const, result })),
                    nextUserMessage.then((next) => ({ source: 'user' as const, next })),
                ])
                : { source: 'sdk' as const, result: await nextSdkMessage };

            // Push next message
            if (event.source === 'user') {
                nextUserMessage = null;
                if (!event.next) {
                    messages.end();
                    return;
                }
                mode = event.next.mode;
                updateThinking(true);
                messages.push({ type: 'user', message: { role: 'user', content: event.next.message } });
                continue;
            }

            nextSdkMessage = null;
            if (event.result.done) {
                break;
            }
            const message = event.result.value;
            logger.debugLargeJson(`[claudeRemote] Message ${message.type}`, message);

            // Handle messages
            opts.onMessage(message);

            // Claude is working again, possibly on a turn it started itself
            if (message.type === 'assistant') {
                updateThinking(true);
            }

            // Handle special system messages
            if (message.type === 'system' && message.subtype === 'init') {
                // Start thinking when session initializes
                updateThinking(true);

                const systemInit = message as SDKSystemMessage;

                // Session id is still in memory, wait until session file is written to disk
                // Start a watcher for to detect the session id
                if (systemInit.session_id) {
                    logger.debug(`[claudeRemote] Waiting for session file to be written to disk: ${systemInit.session_id}`);
                    const projectDir = getProjectPath(opts.path, opts.childEnv?.CLAUDE_CONFIG_DIR);
                    const found = await awaitFileExist(join(projectDir, `${systemInit.session_id}.jsonl`));
                    logger.debug(`[claudeRemote] Session file found: ${systemInit.session_id} ${found}`);
                    opts.onSessionFound(systemInit.session_id);
                }
            }

            // Handle result messages
            if (message.type === 'result') {
                updateThinking(false);
                logger.debug('[claudeRemote] Result received, exiting claudeRemote');

                // Send completion messages
                if (isCompactCommand) {
                    logger.debug('[claudeRemote] Compaction completed');
                    if (opts.onCompletionEvent) {
                        opts.onCompletionEvent('Compaction completed');
                    }
                    isCompactCommand = false;
                }

                // Send ready event
                opts.onReady();

                // Wait for the next message without blocking the stream
                if (!nextUserMessage) {
                    nextUserMessage = opts.nextMessage(userWait.signal);
                    nextUserMessage.catch(() => {});
                }
            }

            // Handle tool result
            if (message.type === 'user') {
                const msg = message as SDKUserMessage;
                if (msg.message.role === 'user' && Array.isArray(msg.message.content)) {
                    for (let c of msg.message.content) {
                        if (c.type === 'tool_result' && c.tool_use_id && opts.isAborted(c.tool_use_id)) {
                            logger.debug('[claudeRemote] Tool aborted, exiting claudeRemote');
                            return;
                        }
                    }
                }
            }
        }
    } catch (e) {
        if (e instanceof AbortError) {
            logger.debug(`[claudeRemote] Aborted`);
            // Ignore
        } else {
            throw e;
        }
    } finally {
        userWait.abort();
        messages.end();
        if (opts.stopChildOnReturn) await response.close();
        iterator.return?.().catch(() => {});
        updateThinking(false);
    }
}
