import type {
    Store,
    StoredReviewLoop,
    StoredReviewLoopStatus,
    StoredReviewLoopUserPreference,
    StoredReviewRound
} from '../store'
import { EventPublisher } from './eventPublisher'

const TERMINAL_STATUSES: StoredReviewLoopStatus[] = ['accepted', 'aborted', 'canceled']

export type ReviewLoopWithRounds = {
    loop: StoredReviewLoop
    rounds: StoredReviewRound[]
}

export type ReviewVerdictInput = {
    action: 'continue' | 'pass' | 'abort' | 'notify_user'
    feedback: string
    userMessage?: string
    progress: number
    criteriaStatus: Array<{
        criteria: string
        status: 'met' | 'not_met' | 'unclear'
        note?: string
    }>
}

type DispatchToWorkerFn = (payload: {
    loopId: string
    namespace: string
    roundId: string
    workerSessionId: string
    instruction: string
}) => Promise<void>

type NotifyUserFn = (payload: {
    loopId: string
    namespace: string
    message: string
    loopStatus: StoredReviewLoopStatus
    round: number
    progress: number
}) => Promise<void>

type DispatchToReviewerFn = (payload: {
    loopId: string
    namespace: string
    roundId: string
    reviewerSessionId: string
    workerOutput: unknown
    requirement: string
    acceptanceCriteria: string
    allRounds: StoredReviewRound[]
    userPreference: StoredReviewLoopUserPreference
}) => Promise<void>

export class ReviewLoopService {
    private readonly store: Store
    private readonly eventPublisher: EventPublisher
    private readonly dispatchToWorker: DispatchToWorkerFn
    private readonly dispatchToReviewer: DispatchToReviewerFn
    private readonly notifyUser: NotifyUserFn

    constructor(
        store: Store,
        eventPublisher: EventPublisher,
        dispatchToWorker: DispatchToWorkerFn,
        dispatchToReviewer: DispatchToReviewerFn,
        notifyUser: NotifyUserFn
    ) {
        this.store = store
        this.eventPublisher = eventPublisher
        this.dispatchToWorker = dispatchToWorker
        this.dispatchToReviewer = dispatchToReviewer
        this.notifyUser = notifyUser
    }

    // ---- CRUD ----

    createLoop(options: {
        namespace: string
        workerSessionId: string
        reviewerSessionId: string
        requirement: string
        acceptanceCriteria: string
        maxRounds?: number
        userPreference?: StoredReviewLoopUserPreference
    }): ReviewLoopWithRounds {
        // A loop over an employee's session counts toward that employee's metrics.
        const workerEmployeeId = (this.store.sessions.getSession(options.workerSessionId)?.metadata as { employeeId?: string } | null)?.employeeId ?? null
        const loop = this.store.reviewLoops.createReviewLoop({ ...options, employeeId: workerEmployeeId })

        this.eventPublisher.emit({
            type: 'review-loop-added',
            loopId: loop.id,
            namespace: loop.namespace
        })

        return { loop, rounds: [] }
    }

    getLoopsByNamespace(namespace: string): StoredReviewLoop[] {
        return this.store.reviewLoops.getReviewLoopsByNamespace(namespace)
    }

    getLoopByNamespace(loopId: string, namespace: string): ReviewLoopWithRounds | null {
        const loop = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)
        if (!loop) {
            return null
        }
        const rounds = this.store.reviewLoops.getReviewRoundsByLoop(loopId, namespace)
        return { loop, rounds }
    }

    deleteLoop(loopId: string, namespace: string): boolean {
        const result = this.store.reviewLoops.deleteReviewLoop({ loopId, namespace })
        if (result) {
            this.eventPublisher.emit({
                type: 'review-loop-removed',
                loopId,
                namespace
            })
        }
        return result
    }

    // ---- User controls ----

    updateUserPreference(
        loopId: string,
        namespace: string,
        userPreference: StoredReviewLoopUserPreference
    ): StoredReviewLoop | null {
        const loop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            userPreference
        })
        if (loop) {
            this.emitLoopUpdated(loop)
        }
        return loop
    }

    updateMaxRounds(
        loopId: string,
        namespace: string,
        maxRounds: number
    ): StoredReviewLoop | null {
        const loop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            maxRounds
        })
        if (loop) {
            this.emitLoopUpdated(loop)
        }
        return loop
    }

    cancelLoop(loopId: string, namespace: string): StoredReviewLoop | null {
        const loop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            status: 'canceled'
        })
        if (loop) {
            this.emitLoopUpdated(loop)
        }
        return loop
    }

    /**
     * Pause a loop that is currently executing or reviewing.
     * When the current round's worker/reviewer finishes, the loop will enter
     * waiting_user instead of auto-advancing.
     * For immediate UX feedback we set status to 'paused' right away.
     */
    pauseLoop(loopId: string, namespace: string): StoredReviewLoop | null {
        const existing = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)
        if (!existing) return null
        if (existing.status !== 'executing' && existing.status !== 'reviewing') {
            throw new Error(`Cannot pause loop in status: ${existing.status}`)
        }
        const loop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            status: 'paused'
        })
        if (loop) {
            this.emitLoopUpdated(loop)
        }
        return loop
    }

    /**
     * User steer: update requirement/criteria mid-loop
     */
    steerLoop(
        loopId: string,
        namespace: string,
        options: {
            requirement?: string
            acceptanceCriteria?: string
        }
    ): StoredReviewLoop | null {
        const existing = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)
        if (!existing) {
            return null
        }
        // For steer, we need direct DB update since our generic update doesn't cover requirement/criteria
        // We'll handle this via a specific store method or update inline
        // For now, use the existing store — extend if needed
        // TODO: Add requirement/acceptanceCriteria to updateReviewLoop if steer is common
        return existing
    }

    // ---- State Machine: Core flow ----

    /**
     * Start a new round. Called when:
     * - Loop is first created
     * - Reviewer says 'continue'
     * - User says 'go' from waiting_user state
     */
    async startRound(loopId: string, namespace: string, instruction: string): Promise<StoredReviewRound> {
        const loop = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)
        if (!loop) {
            throw new Error(`Review loop ${loopId} not found`)
        }

        if (TERMINAL_STATUSES.includes(loop.status)) {
            throw new Error(`Review loop ${loopId} is in terminal status: ${loop.status}`)
        }

        const nextRound = loop.currentRound + 1

        // Check maxRounds
        if (nextRound > loop.maxRounds) {
            // Notify user that max rounds reached
            const updated = this.store.reviewLoops.updateReviewLoop({
                loopId,
                namespace,
                status: 'waiting_user'
            })
            if (updated) {
                this.emitLoopUpdated(updated)
            }
            await this.notifyUser({
                loopId,
                namespace,
                message: `Review loop reached maximum rounds (${loop.maxRounds}). Increase limit or cancel.`,
                loopStatus: 'waiting_user',
                round: loop.currentRound,
                progress: 0
            })
            throw new Error(`Review loop ${loopId} reached max rounds (${loop.maxRounds})`)
        }

        // Create round
        const round = this.store.reviewLoops.createReviewRound({
            loopId,
            namespace,
            round: nextRound,
            instruction
        })

        // Update loop
        const updatedLoop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            status: 'executing',
            currentRound: nextRound
        })
        if (updatedLoop) {
            this.emitLoopUpdated(updatedLoop)
        }

        this.eventPublisher.emit({
            type: 'review-loop-round-updated',
            loopId,
            namespace,
            round
        })

        // Dispatch instruction to worker
        try {
            await this.dispatchToWorker({
                loopId,
                namespace,
                roundId: round.id,
                workerSessionId: loop.workerSessionId,
                instruction
            })
        } catch (err) {
            // Dispatch failed — rollback loop to waiting_user so user can retry
            this.store.reviewLoops.updateReviewLoop({
                loopId,
                namespace,
                status: 'waiting_user'
            })
            throw err
        }

        // Update round status to executing after successful dispatch
        this.store.reviewLoops.updateReviewRound({
            roundId: round.id,
            namespace,
            status: 'executing'
        })

        return round
    }

    /**
     * Worker has finished executing. Record output and automatically dispatch to reviewer.
     */
    async submitWorkerOutput(
        loopId: string,
        namespace: string,
        roundId: string,
        workerOutput: unknown
    ): Promise<StoredReviewRound> {
        const loop = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)
        if (!loop) {
            throw new Error(`Review loop ${loopId} not found`)
        }
        if (TERMINAL_STATUSES.includes(loop.status)) {
            throw new Error(`Review loop ${loopId} is in terminal status: ${loop.status}`)
        }

        // Guard: only accept output for rounds in 'executing' status
        const existingRound = this.store.reviewLoops.getReviewRoundByNamespace(roundId, namespace)
        if (existingRound && existingRound.status !== 'executing' && existingRound.status !== 'instructed') {
            throw new Error(`Round ${roundId} is not accepting worker output (status: ${existingRound.status})`)
        }

        // Update round with worker output
        const round = this.store.reviewLoops.updateReviewRound({
            roundId,
            namespace,
            status: 'executed',
            workerOutput
        })
        if (!round) {
            throw new Error(`Review round ${roundId} not found`)
        }

        // If loop was paused while worker was executing, go to waiting_user
        if (loop.status === 'paused') {
            const pausedLoop = this.store.reviewLoops.updateReviewLoop({
                loopId,
                namespace,
                status: 'waiting_user'
            })
            if (pausedLoop) {
                this.emitLoopUpdated(pausedLoop)
            }
            this.eventPublisher.emit({
                type: 'review-loop-round-updated',
                loopId,
                namespace,
                round
            })
            await this.notifyUser({
                loopId,
                namespace,
                message: 'Worker finished. Loop is paused — review the output and continue when ready.',
                loopStatus: 'waiting_user',
                round: loop.currentRound,
                progress: 0
            })
            return round
        }

        // Update loop status to reviewing
        const updatedLoop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            status: 'reviewing'
        })
        if (updatedLoop) {
            this.emitLoopUpdated(updatedLoop)
        }

        this.eventPublisher.emit({
            type: 'review-loop-round-updated',
            loopId,
            namespace,
            round
        })

        // Auto-orchestration: build reviewer prompt and dispatch automatically
        const allRounds = this.store.reviewLoops.getReviewRoundsByLoop(loopId, namespace)
        await this.dispatchToReviewer({
            loopId,
            namespace,
            roundId: round.id,
            reviewerSessionId: loop.reviewerSessionId,
            workerOutput,
            requirement: loop.requirement,
            acceptanceCriteria: loop.acceptanceCriteria,
            allRounds,
            userPreference: loop.userPreference
        })

        return round
    }

    /**
     * Reviewer has submitted verdict. Auto-advance the state machine based on action.
     */
    async submitVerdict(
        loopId: string,
        namespace: string,
        roundId: string,
        verdict: ReviewVerdictInput
    ): Promise<{ loop: StoredReviewLoop; round: StoredReviewRound; nextAction: string }> {
        const loop = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)
        if (!loop) {
            throw new Error(`Review loop ${loopId} not found`)
        }
        if (TERMINAL_STATUSES.includes(loop.status)) {
            throw new Error(`Review loop ${loopId} is in terminal status: ${loop.status}`)
        }

        // Guard: only accept verdict for rounds in 'executed' status
        const existingRound = this.store.reviewLoops.getReviewRoundByNamespace(roundId, namespace)
        if (existingRound && existingRound.status === 'reviewed') {
            throw new Error(`Round ${roundId} has already been reviewed`)
        }

        // Update round with verdict
        const round = this.store.reviewLoops.updateReviewRound({
            roundId,
            namespace,
            status: 'reviewed',
            verdict
        })
        if (!round) {
            throw new Error(`Review round ${roundId} not found`)
        }

        this.eventPublisher.emit({
            type: 'review-loop-round-updated',
            loopId,
            namespace,
            round
        })

        // If loop was paused while reviewer was working, go to waiting_user regardless of verdict
        if (loop.status === 'paused') {
            const pausedLoop = this.store.reviewLoops.updateReviewLoop({
                loopId,
                namespace,
                status: 'waiting_user'
            })
            if (pausedLoop) {
                this.emitLoopUpdated(pausedLoop)
            }
            await this.notifyUser({
                loopId,
                namespace,
                message: `Reviewer finished (verdict: ${verdict.action}). Loop is paused — add your instructions and continue when ready.`,
                loopStatus: 'waiting_user',
                round: loop.currentRound,
                progress: verdict.progress
            })
            return {
                loop: pausedLoop ?? loop,
                round,
                nextAction: 'paused_by_user'
            }
        }

        // Route based on verdict action and auto-advance
        let nextAction: string
        let newStatus: StoredReviewLoopStatus

        switch (verdict.action) {
            case 'pass': {
                newStatus = 'accepted'
                nextAction = 'completed'
                await this.notifyUser({
                    loopId,
                    namespace,
                    message: `Review loop completed successfully. All criteria met.`,
                    loopStatus: 'accepted',
                    round: loop.currentRound,
                    progress: verdict.progress
                })
                break
            }
            case 'abort': {
                newStatus = 'aborted'
                nextAction = 'aborted'
                await this.notifyUser({
                    loopId,
                    namespace,
                    message: `Reviewer aborted: ${verdict.feedback}`,
                    loopStatus: 'aborted',
                    round: loop.currentRound,
                    progress: verdict.progress
                })
                break
            }
            case 'notify_user': {
                newStatus = 'waiting_user'
                nextAction = 'waiting_user'
                await this.notifyUser({
                    loopId,
                    namespace,
                    message: verdict.userMessage ?? verdict.feedback,
                    loopStatus: 'waiting_user',
                    round: loop.currentRound,
                    progress: verdict.progress
                })
                break
            }
            case 'continue': {
                if (loop.userPreference === 'verbose') {
                    // Notify user but still auto-continue (don't wait)
                    newStatus = 'executing'
                    nextAction = 'auto_continue_verbose'
                    await this.notifyUser({
                        loopId,
                        namespace,
                        message: `Round ${loop.currentRound} completed (${verdict.progress}% done). Feedback: ${verdict.feedback}. Auto-continuing...`,
                        loopStatus: 'executing',
                        round: loop.currentRound,
                        progress: verdict.progress
                    })
                } else {
                    // auto or silent: continue silently
                    newStatus = 'executing'
                    nextAction = 'auto_continue'
                }
                break
            }
            default: {
                newStatus = 'waiting_user'
                nextAction = 'unknown'
            }
        }

        const updatedLoop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            status: newStatus
        })

        if (updatedLoop) {
            this.emitLoopUpdated(updatedLoop)
        }

        // Auto-advance: if verdict is 'continue', automatically start the next round
        if (verdict.action === 'continue') {
            try {
                await this.startRound(loopId, namespace, verdict.feedback)
            } catch (err) {
                // startRound failed (e.g. max rounds). Rollback to waiting_user so user can act.
                const rolledBack = this.store.reviewLoops.updateReviewLoop({
                    loopId,
                    namespace,
                    status: 'waiting_user'
                })
                if (rolledBack) {
                    this.emitLoopUpdated(rolledBack)
                }
            }
        }

        // Re-fetch loop in case startRound updated it
        const finalLoop = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)

        return {
            loop: finalLoop ?? updatedLoop ?? loop,
            round,
            nextAction
        }
    }

    /**
     * User continues loop from waiting_user state (the "gas pedal").
     */
    async userContinue(
        loopId: string,
        namespace: string,
        options?: {
            userPreference?: StoredReviewLoopUserPreference
            additionalInstruction?: string
        }
    ): Promise<StoredReviewLoop> {
        const loop = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)
        if (!loop) {
            throw new Error(`Review loop ${loopId} not found`)
        }

        if (loop.status !== 'waiting_user' && loop.status !== 'paused') {
            throw new Error(`Review loop ${loopId} is not waiting for user (status: ${loop.status})`)
        }

        // Prevent infinite loop: if already at max rounds, don't try to start another
        if (loop.currentRound >= loop.maxRounds) {
            throw new Error(`Review loop ${loopId} has reached max rounds (${loop.maxRounds}). Increase maxRounds first.`)
        }

        // Update preference if provided
        if (options?.userPreference) {
            this.store.reviewLoops.updateReviewLoop({
                loopId,
                namespace,
                userPreference: options.userPreference
            })
        }

        // Get the latest round's verdict feedback as instruction base
        const latestRound = this.store.reviewLoops.getLatestReviewRound(loopId, namespace)
        let instruction = ''

        if (latestRound?.verdict) {
            const verdict = latestRound.verdict as ReviewVerdictInput
            instruction = verdict.feedback
        }
        if (options?.additionalInstruction) {
            instruction = instruction
                ? `${instruction}\n\nAdditional user instruction: ${options.additionalInstruction}`
                : options.additionalInstruction
        }

        if (!instruction) {
            instruction = 'Continue working on the task based on previous feedback.'
        }

        // Update loop to executing before dispatching
        const updatedLoop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            status: 'executing'
        })
        if (updatedLoop) {
            this.emitLoopUpdated(updatedLoop)
        }

        // Start next round
        await this.startRound(loopId, namespace, instruction)

        return updatedLoop ?? loop
    }

    // ---- Auto-orchestration: Initiate ----

    /**
     * Kick off the entire review loop after creation.
     * Creates round 1 and dispatches to the reviewer asking it to generate
     * the first worker instruction based on the requirement + criteria.
     */
    async initiateLoop(loopId: string, namespace: string): Promise<StoredReviewRound> {
        const loop = this.store.reviewLoops.getReviewLoopByNamespace(loopId, namespace)
        if (!loop) {
            throw new Error(`Review loop ${loopId} not found`)
        }

        // Guard: only initiate from initial state (currentRound === 0)
        if (loop.currentRound > 0) {
            throw new Error(`Review loop ${loopId} has already been initiated (round ${loop.currentRound})`)
        }
        if (TERMINAL_STATUSES.includes(loop.status)) {
            throw new Error(`Review loop ${loopId} is in terminal status: ${loop.status}`)
        }

        // Create round 1 with a placeholder instruction (reviewer will generate the real one)
        const round = this.store.reviewLoops.createReviewRound({
            loopId,
            namespace,
            round: 1,
            instruction: '(awaiting reviewer initial instruction)'
        })

        // Update loop to reviewing state — the reviewer will produce the first instruction
        const updatedLoop = this.store.reviewLoops.updateReviewLoop({
            loopId,
            namespace,
            status: 'reviewing',
            currentRound: 1
        })
        if (updatedLoop) {
            this.emitLoopUpdated(updatedLoop)
        }

        this.eventPublisher.emit({
            type: 'review-loop-round-updated',
            loopId,
            namespace,
            round
        })

        // Dispatch to reviewer asking for the first worker instruction
        await this.dispatchToReviewer({
            loopId,
            namespace,
            roundId: round.id,
            reviewerSessionId: loop.reviewerSessionId,
            workerOutput: null,
            requirement: loop.requirement,
            acceptanceCriteria: loop.acceptanceCriteria,
            allRounds: [],
            userPreference: loop.userPreference
        })

        return round
    }

    // ---- Helpers ----

    private emitLoopUpdated(loop: StoredReviewLoop): void {
        this.eventPublisher.emit({
            type: 'review-loop-updated',
            loopId: loop.id,
            namespace: loop.namespace
        })
    }
}
