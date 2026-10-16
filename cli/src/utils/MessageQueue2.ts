import { logger } from "@/ui/logger";

export interface MessageQueueItem<T> {
    id: string;
    message: string;
    mode: T;
    modeHash: string;
    isolate: boolean; // If true, this message must be processed alone
    deferUserMessageUntilDequeue: boolean;
    enqueuedAt: number;
}

/**
 * A mode-aware message queue that stores messages with their modes.
 * Returns consistent batches of messages with the same mode.
 */
export class MessageQueue2<T> {
    public queue: MessageQueueItem<T>[] = []; // Made public for testing
    private waiter: ((hasMessages: boolean) => void) | null = null;
    private closed = false;
    private dequeuePaused = false;
    private onMessageHandler: ((message: string, mode: T) => void) | null = null;
    private nextItemId = 1;
    modeHasher: (mode: T) => string;

    constructor(
        modeHasher: (mode: T) => string,
        onMessageHandler: ((message: string, mode: T) => void) | null = null
    ) {
        this.modeHasher = modeHasher;
        this.onMessageHandler = onMessageHandler;
        logger.debug(`[MessageQueue2] Initialized`);
    }

    /**
     * Set a handler that will be called when a message arrives
     */
    setOnMessage(handler: ((message: string, mode: T) => void) | null): void {
        this.onMessageHandler = handler;
    }

    private createQueueItem(
        message: string,
        mode: T,
        isolate: boolean,
        deferUserMessageUntilDequeue: boolean
    ): MessageQueueItem<T> {
        const modeHash = this.modeHasher(mode);
        const id = `mq_${Date.now().toString(36)}_${(this.nextItemId++).toString(36)}`;
        return {
            id,
            message,
            mode,
            modeHash,
            isolate,
            deferUserMessageUntilDequeue,
            enqueuedAt: Date.now()
        };
    }

    private notifyWaiter(): void {
        if (!this.waiter) {
            return;
        }
        logger.debug(`[MessageQueue2] Notifying waiter`);
        const waiter = this.waiter;
        this.waiter = null;
        waiter(true);
    }

    /**
     * Return a snapshot copy of all pending queue entries in order.
     */
    listEntries(): MessageQueueItem<T>[] {
        return this.queue.map((item) => ({ ...item }));
    }

    /**
     * Return the first pending queue entry (if any) without removing it.
     */
    peek(): MessageQueueItem<T> | null {
        const first = this.queue[0];
        return first ? { ...first } : null;
    }

    /**
     * Remove one queue entry by id.
     */
    removeById(id: string): MessageQueueItem<T> | null {
        const index = this.queue.findIndex((item) => item.id === id);
        if (index < 0) {
            return null;
        }
        const [removed] = this.queue.splice(index, 1);
        return removed ?? null;
    }

    /**
     * Move one queue entry to a specific index.
     */
    moveById(id: string, toIndex: number): boolean {
        if (!Number.isFinite(toIndex)) {
            return false;
        }
        const fromIndex = this.queue.findIndex((item) => item.id === id);
        if (fromIndex < 0) {
            return false;
        }
        const normalizedTarget = Math.max(0, Math.min(Math.floor(toIndex), this.queue.length - 1));
        if (fromIndex === normalizedTarget) {
            return true;
        }
        const [item] = this.queue.splice(fromIndex, 1);
        if (!item) {
            return false;
        }
        this.queue.splice(normalizedTarget, 0, item);
        return true;
    }

    /**
     * Clear all pending queue items and return cleared count.
     */
    clear(): number {
        const removed = this.queue.length;
        this.queue = [];
        return removed;
    }

    pauseDequeue(): void {
        this.dequeuePaused = true;
    }

    resumeDequeue(): void {
        const wasPaused = this.dequeuePaused;
        this.dequeuePaused = false;
        if (wasPaused && this.queue.length > 0) {
            this.notifyWaiter();
        }
    }

    isDequeuePaused(): boolean {
        return this.dequeuePaused;
    }

    /**
     * Drain all pending queue entries in order and clear the queue.
     */
    drainEntries(): MessageQueueItem<T>[] {
        const drained = this.queue.map((item) => ({ ...item }));
        this.queue = [];
        return drained;
    }

    /**
     * Push a message to the queue with a mode.
     */
    push(message: string, mode: T, options?: { deferUserMessageUntilDequeue?: boolean; isolate?: boolean }): void {
        if (this.closed) {
            throw new Error('Cannot push to closed queue');
        }

        const queueItem = this.createQueueItem(
            message,
            mode,
            options?.isolate === true,
            options?.deferUserMessageUntilDequeue === true
        );
        const modeHash = queueItem.modeHash;
        logger.debug(`[MessageQueue2] push() called with mode hash: ${modeHash}`);

        this.queue.push(queueItem);

        // Trigger message handler if set
        if (this.onMessageHandler) {
            this.onMessageHandler(message, mode);
        }

        this.notifyWaiter();

        logger.debug(`[MessageQueue2] push() completed. Queue size: ${this.queue.length}`);
    }

    /**
     * Push a message immediately without batching delay.
     * Does not clear the queue or enforce isolation.
     */
    pushImmediate(message: string, mode: T, options?: { deferUserMessageUntilDequeue?: boolean }): void {
        if (this.closed) {
            throw new Error('Cannot push to closed queue');
        }

        const queueItem = this.createQueueItem(message, mode, false, options?.deferUserMessageUntilDequeue === true);
        const modeHash = queueItem.modeHash;
        logger.debug(`[MessageQueue2] pushImmediate() called with mode hash: ${modeHash}`);

        this.queue.push(queueItem);

        // Trigger message handler if set
        if (this.onMessageHandler) {
            this.onMessageHandler(message, mode);
        }

        this.notifyWaiter();

        logger.debug(`[MessageQueue2] pushImmediate() completed. Queue size: ${this.queue.length}`);
    }

    /**
     * Push a message that must be processed in complete isolation.
     * Clears any pending messages and ensures this message is never batched with others.
     * Used for special commands that require dedicated processing.
     */
    pushIsolateAndClear(message: string, mode: T, options?: { deferUserMessageUntilDequeue?: boolean }): void {
        if (this.closed) {
            throw new Error('Cannot push to closed queue');
        }

        const queueItem = this.createQueueItem(message, mode, true, options?.deferUserMessageUntilDequeue === true);
        const modeHash = queueItem.modeHash;
        logger.debug(`[MessageQueue2] pushIsolateAndClear() called with mode hash: ${modeHash} - clearing ${this.queue.length} pending messages`);

        // Clear any pending messages to ensure this message is processed in complete isolation
        this.queue = [];

        this.queue.push(queueItem);

        // Trigger message handler if set
        if (this.onMessageHandler) {
            this.onMessageHandler(message, mode);
        }

        this.notifyWaiter();

        logger.debug(`[MessageQueue2] pushIsolateAndClear() completed. Queue size: ${this.queue.length}`);
    }

    /**
     * Push a message to the beginning of the queue with a mode.
     */
    unshift(
        message: string,
        mode: T,
        options?: { deferUserMessageUntilDequeue?: boolean; isolate?: boolean }
    ): void {
        if (this.closed) {
            throw new Error('Cannot unshift to closed queue');
        }

        const queueItem = this.createQueueItem(
            message,
            mode,
            options?.isolate === true,
            options?.deferUserMessageUntilDequeue === true
        );
        const modeHash = queueItem.modeHash;
        logger.debug(`[MessageQueue2] unshift() called with mode hash: ${modeHash}`);

        this.queue.unshift(queueItem);

        // Trigger message handler if set
        if (this.onMessageHandler) {
            this.onMessageHandler(message, mode);
        }

        this.notifyWaiter();

        logger.debug(`[MessageQueue2] unshift() completed. Queue size: ${this.queue.length}`);
    }

    /**
     * Reset the queue - clears all messages and resets to empty state
     */
    reset(): void {
        logger.debug(`[MessageQueue2] reset() called. Clearing ${this.queue.length} messages`);
        this.clear();
        this.closed = false;
        this.dequeuePaused = false;

        // Clear waiter without calling it since we're not closing
        this.waiter = null;
    }

    /**
     * Close the queue - no more messages can be pushed
     */
    close(): void {
        logger.debug(`[MessageQueue2] close() called`);
        this.closed = true;

        // Notify any waiting caller
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter(false);
        }
    }

    /**
     * Check if the queue is closed
     */
    isClosed(): boolean {
        return this.closed;
    }

    /**
     * Get the current queue size
     */
    size(): number {
        return this.queue.length;
    }

    /**
     * Wait for messages and return all messages with the same mode as a single string
     * Returns { message: string, mode: T } or null if aborted/closed
     */
    async waitForMessagesAndGetAsString(abortSignal?: AbortSignal): Promise<{
        message: string;
        mode: T;
        isolate: boolean;
        hash: string;
        deferUserMessageUntilDequeue: boolean;
    } | null> {
        while (true) {
            if (this.queue.length > 0 && !this.dequeuePaused) {
                return this.collectBatch();
            }

            if (this.closed || abortSignal?.aborted) {
                return null;
            }

            const hasMessages = await this.waitForMessages(abortSignal);
            if (!hasMessages) {
                return null;
            }
        }
    }

    /**
     * Wait until a message can be dequeued and return the first one without removing it.
     * Returns null if aborted/closed.
     */
    async waitForHead(abortSignal?: AbortSignal): Promise<MessageQueueItem<T> | null> {
        while (true) {
            if (this.queue.length > 0 && !this.dequeuePaused) {
                return { ...this.queue[0] };
            }

            if (this.closed || abortSignal?.aborted) {
                return null;
            }

            const hasMessages = await this.waitForMessages(abortSignal);
            if (!hasMessages) {
                return null;
            }
        }
    }

    /**
     * Collect a batch of messages with the same mode, respecting isolation requirements
     */
    private collectBatch(): {
        message: string;
        mode: T;
        hash: string;
        isolate: boolean;
        deferUserMessageUntilDequeue: boolean;
    } | null {
        if (this.queue.length === 0) {
            return null;
        }

        const firstItem = this.queue[0];
        const sameModeMessages: string[] = [];
        let mode = firstItem.mode;
        let isolate = firstItem.isolate;
        const deferUserMessageUntilDequeue = firstItem.deferUserMessageUntilDequeue;
        const targetModeHash = firstItem.modeHash;

        // If the first message requires isolation, only process it alone
        if (firstItem.isolate) {
            const item = this.queue.shift()!;
            sameModeMessages.push(item.message);
            logger.debug(`[MessageQueue2] Collected isolated message with mode hash: ${targetModeHash}`);
        } else {
            // Collect all messages with the same mode until we hit an isolated message
            while (this.queue.length > 0 &&
                this.queue[0].modeHash === targetModeHash &&
                !this.queue[0].isolate &&
                this.queue[0].deferUserMessageUntilDequeue === deferUserMessageUntilDequeue) {
                const item = this.queue.shift()!;
                sameModeMessages.push(item.message);
            }
            logger.debug(`[MessageQueue2] Collected batch of ${sameModeMessages.length} messages with mode hash: ${targetModeHash}`);
        }

        // Join all messages with newlines
        const combinedMessage = sameModeMessages.join('\n');

        return {
            message: combinedMessage,
            mode,
            hash: targetModeHash,
            isolate,
            deferUserMessageUntilDequeue
        };
    }

    /**
     * Wait for messages to arrive
     */
    private waitForMessages(abortSignal?: AbortSignal): Promise<boolean> {
        return new Promise((resolve) => {
            let settled = false;
            let abortHandler: (() => void) | null = null;
            let waiterFunc: (hasMessages: boolean) => void;

            const finish = (hasMessages: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (this.waiter === waiterFunc) {
                    this.waiter = null;
                }
                // Clean up abort handler
                if (abortHandler && abortSignal) {
                    abortSignal.removeEventListener('abort', abortHandler);
                }
                resolve(hasMessages);
            };

            waiterFunc = (hasMessages: boolean) => {
                finish(hasMessages);
            };

            // Set up abort handler
            if (abortSignal) {
                abortHandler = () => {
                    logger.debug('[MessageQueue2] Wait aborted');
                    finish(false);
                };
                abortSignal.addEventListener('abort', abortHandler);
            }

            // Set the waiter before checking the queue to avoid missed notifications
            this.waiter = waiterFunc;

            // Check again in case messages arrived or queue closed while setting up
            if (this.queue.length > 0 && !this.dequeuePaused) {
                finish(true);
                return;
            }

            if (this.closed || abortSignal?.aborted) {
                finish(false);
                return;
            }

            logger.debug('[MessageQueue2] Waiting for messages...');
        });
    }
}
