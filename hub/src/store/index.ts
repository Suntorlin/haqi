import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { MachineStore } from './machineStore'
import { MessageStore } from './messageStore'
import { TurnStore } from './turnStore'
import { ProjectPreferenceStore } from './projectPreferenceStore'
import { PushStore } from './pushStore'
import { SessionStore } from './sessionStore'
import { UserStore } from './userStore'
import { GroupStore } from './groupStore'
import { ReportStore } from './reportStore'
import { ReviewLoopStore } from './reviewLoopStore'
import { createConversationTurnsSchema } from './turns'
import { createGroupConversationTurnsSchema } from './groupTurns'

export type {
    PreviewUrlHistoryEntry,
    StoredGroup,
    StoredGroupConversationTurn,
    StoredGroupMember,
    StoredGroupMessage,
    StoredGroupNote,
    StoredGroupTask,
    StoredMachine,
    StoredConversationTurn,
    StoredMessage,
    StoredPushSubscription,
    StoredReport,
    StoredReportAsset,
    StoredReportShare,
    StoredReviewLoop,
    StoredReviewLoopStatus,
    StoredReviewLoopUserPreference,
    StoredReviewRound,
    StoredReviewRoundStatus,
    StoredSession,
    StoredUser,
    VersionedUpdateResult
} from './types'
export { MachineStore } from './machineStore'
export { MessageStore } from './messageStore'
export { TurnStore } from './turnStore'
export { ProjectPreferenceStore } from './projectPreferenceStore'
export { PushStore } from './pushStore'
export { SessionStore } from './sessionStore'
export { UserStore } from './userStore'
export { GroupStore } from './groupStore'
export { ReportStore } from './reportStore'
export { ReviewLoopStore } from './reviewLoopStore'

const SCHEMA_VERSION: number = 13
const REQUIRED_TABLES = [
    'sessions',
    'machines',
    'messages',
    'conversation_turns',
    'users',
    'push_subscriptions',
    'preview_url_history',
    'project_offline_preferences',
    'groups',
    'group_members',
    'group_messages',
    'group_conversation_turns',
    'group_tasks',
    'group_notes',
    'reports',
    'report_assets',
    'report_shares',
    'review_loops',
    'review_rounds'
] as const

export class Store {
    private db: Database
    private readonly dbPath: string

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly messages: MessageStore
    readonly turns: TurnStore
    readonly users: UserStore
    readonly push: PushStore
    readonly projectPreferences: ProjectPreferenceStore
    readonly groups: GroupStore
    readonly reports: ReportStore
    readonly reviewLoops: ReviewLoopStore

    constructor(dbPath: string) {
        this.dbPath = dbPath
        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            const dir = dirname(dbPath)
            mkdirSync(dir, { recursive: true, mode: 0o700 })
            try {
                chmodSync(dir, 0o700)
            } catch {
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch {
                }
            }
        }

        this.db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()

        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
                try {
                    chmodSync(path, 0o600)
                } catch {
                }
            }
        }

        this.sessions = new SessionStore(this.db)
        this.machines = new MachineStore(this.db)
        this.messages = new MessageStore(this.db)
        this.turns = new TurnStore(this.db)
        this.users = new UserStore(this.db)
        this.push = new PushStore(this.db)
        this.projectPreferences = new ProjectPreferenceStore(this.db)
        this.groups = new GroupStore(this.db)
        this.reports = new ReportStore(this.db)
        this.reviewLoops = new ReviewLoopStore(this.db)
    }

    getDatabasePath(): string {
        return this.dbPath
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                this.migrateLegacySchemaIfNeeded()
                this.createSchema()
                this.setUserVersion(SCHEMA_VERSION)
                return
            }

            this.createSchema()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 1 && SCHEMA_VERSION >= 2) {
            this.migrateFromV1ToV2()
            this.setUserVersion(2)
            this.initSchema()
            return
        }

        if (currentVersion === 2 && SCHEMA_VERSION >= 3) {
            this.migrateFromV2ToV3()
            this.setUserVersion(3)
            this.initSchema()
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION >= 4) {
            this.migrateFromV3ToV4()
            this.setUserVersion(4)
            this.initSchema()
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION >= 5) {
            this.migrateFromV4ToV5()
            this.setUserVersion(5)
            this.initSchema()
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION >= 6) {
            this.migrateFromV5ToV6()
            this.setUserVersion(6)
            this.initSchema()
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION >= 7) {
            this.migrateFromV6ToV7()
            this.setUserVersion(7)
            this.initSchema()
            return
        }

        if (currentVersion === 7 && SCHEMA_VERSION >= 8) {
            this.migrateFromV7ToV8()
            this.setUserVersion(8)
            this.initSchema()
            return
        }

        if (currentVersion === 8 && SCHEMA_VERSION >= 9) {
            this.migrateFromV8ToV9()
            this.setUserVersion(9)
            this.initSchema()
            return
        }

        if (currentVersion === 9 && SCHEMA_VERSION >= 10) {
            this.migrateFromV9ToV10()
            this.setUserVersion(10)
            this.initSchema()
            return
        }

        if (currentVersion === 10 && SCHEMA_VERSION >= 11) {
            this.migrateFromV10ToV11()
            this.setUserVersion(11)
            this.initSchema()
            return
        }

        if (currentVersion === 11 && SCHEMA_VERSION >= 12) {
            this.migrateFromV11ToV12()
            this.setUserVersion(12)
            this.initSchema()
            return
        }

        if (currentVersion === 12 && SCHEMA_VERSION >= 13) {
            this.migrateFromV12ToV13()
            this.setUserVersion(13)
            this.initSchema()
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION === 4) {
            this.migrateFromV3ToV4()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion)
        }

        this.ensureRequiredTablesPresent()
        this.ensureGroupMessageColumnsPresent()
    }

    private createSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                tag TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                agent_state TEXT,
                agent_state_version INTEGER DEFAULT 1,
                preview_url TEXT,
                todos TEXT,
                todos_updated_at INTEGER,
                team_state TEXT,
                team_state_updated_at INTEGER,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);

            CREATE TABLE IF NOT EXISTS machines (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                runner_state TEXT,
                runner_state_version INTEGER DEFAULT 1,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                local_id TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS conversation_turns (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                turn_index INTEGER NOT NULL,
                status TEXT NOT NULL,
                user_message_id TEXT,
                user_seq INTEGER,
                agent_start_seq INTEGER,
                agent_end_seq INTEGER,
                message_count INTEGER NOT NULL DEFAULT 0,
                user_preview TEXT,
                assistant_preview TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (user_message_id) REFERENCES messages(id) ON DELETE SET NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_turns_session_turn_index
                ON conversation_turns(session_id, turn_index);
            CREATE INDEX IF NOT EXISTS idx_conversation_turns_session_updated
                ON conversation_turns(session_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conversation_turns_session_status
                ON conversation_turns(session_id, status, turn_index DESC);

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(namespace, endpoint)
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);

            CREATE TABLE IF NOT EXISTS preview_url_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                url TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL,
                UNIQUE(namespace, url)
            );
            CREATE INDEX IF NOT EXISTS idx_preview_url_history_namespace_last_used
                ON preview_url_history(namespace, last_used_at DESC);

            CREATE TABLE IF NOT EXISTS project_offline_preferences (
                namespace TEXT NOT NULL DEFAULT 'default',
                user_id INTEGER NOT NULL,
                directory TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, user_id, directory),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_offline_preferences_namespace_user
                ON project_offline_preferences(namespace, user_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                name TEXT NOT NULL,
                description TEXT,
                note_session_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_groups_namespace ON groups(namespace);

            CREATE TABLE IF NOT EXISTS group_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                member_type TEXT NOT NULL,
                session_id TEXT,
                user_id INTEGER,
                role TEXT NOT NULL DEFAULT 'member',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
            CREATE INDEX IF NOT EXISTS idx_group_members_namespace ON group_members(namespace);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_dedupe
                ON group_members(group_id, member_type, session_id, user_id);

            CREATE TABLE IF NOT EXISTS group_messages (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                seq INTEGER NOT NULL,
                type TEXT NOT NULL,
                trace_id TEXT,
                task_id TEXT,
                source TEXT NOT NULL,
                actor_session_id TEXT,
                actor_name TEXT,
                target_session_ids TEXT,
                quoted_message_id TEXT,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_group_messages_group_seq
                ON group_messages(group_id, seq);
            CREATE INDEX IF NOT EXISTS idx_group_messages_namespace_created
                ON group_messages(namespace, created_at DESC);

            CREATE TABLE IF NOT EXISTS group_conversation_turns (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                turn_index INTEGER NOT NULL,
                status TEXT NOT NULL,
                initiator_message_id TEXT,
                initiator_seq INTEGER,
                initiator_source TEXT,
                initiator_actor_session_id TEXT,
                responder_start_seq INTEGER,
                responder_end_seq INTEGER,
                message_count INTEGER NOT NULL DEFAULT 0,
                initiator_preview TEXT,
                responder_preview TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (initiator_message_id) REFERENCES group_messages(id) ON DELETE SET NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_group_conversation_turns_group_turn_index
                ON group_conversation_turns(group_id, namespace, turn_index);
            CREATE INDEX IF NOT EXISTS idx_group_conversation_turns_group_updated
                ON group_conversation_turns(group_id, namespace, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_group_conversation_turns_group_status
                ON group_conversation_turns(group_id, namespace, status, turn_index DESC);

            CREATE TABLE IF NOT EXISTS group_tasks (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                trace_id TEXT NOT NULL,
                source TEXT NOT NULL,
                target_session_id TEXT NOT NULL,
                command TEXT NOT NULL,
                status TEXT NOT NULL,
                dedupe_key TEXT,
                expires_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER,
                error TEXT,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (target_session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_group_tasks_group_status
                ON group_tasks(group_id, status);
            CREATE INDEX IF NOT EXISTS idx_group_tasks_namespace_created
                ON group_tasks(namespace, created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_group_tasks_dedupe_key
                ON group_tasks(group_id, dedupe_key)
                WHERE dedupe_key IS NOT NULL;

            CREATE TABLE IF NOT EXISTS group_notes (
                group_id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                content TEXT NOT NULL DEFAULT '',
                version INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
                );
            CREATE INDEX IF NOT EXISTS idx_group_notes_namespace ON group_notes(namespace);

            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                session_id TEXT,
                task_id TEXT,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'unknown',
                markdown TEXT NOT NULL DEFAULT '',
                metadata TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_reports_namespace_updated
                ON reports(namespace, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_reports_session_namespace
                ON reports(session_id, namespace);

            CREATE TABLE IF NOT EXISTS report_assets (
                id TEXT PRIMARY KEY,
                report_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                file_name TEXT NOT NULL,
                storage_key TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size INTEGER NOT NULL,
                caption TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_report_assets_report
                ON report_assets(report_id, created_at ASC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_report_assets_storage_key
                ON report_assets(report_id, storage_key);

            CREATE TABLE IF NOT EXISTS report_shares (
                id TEXT PRIMARY KEY,
                report_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                token TEXT NOT NULL UNIQUE,
                created_by TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER,
                revoked_at INTEGER,
                FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_report_shares_report
                ON report_shares(report_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_report_shares_token
                ON report_shares(token);

            CREATE TABLE IF NOT EXISTS review_loops (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                worker_session_id TEXT NOT NULL,
                reviewer_session_id TEXT NOT NULL,
                requirement TEXT NOT NULL,
                acceptance_criteria TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'executing',
                user_preference TEXT NOT NULL DEFAULT 'auto',
                current_round INTEGER NOT NULL DEFAULT 0,
                max_rounds INTEGER NOT NULL DEFAULT 10,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (worker_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (reviewer_session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_review_loops_namespace
                ON review_loops(namespace);
            CREATE INDEX IF NOT EXISTS idx_review_loops_namespace_status
                ON review_loops(namespace, status);

            CREATE TABLE IF NOT EXISTS review_rounds (
                id TEXT PRIMARY KEY,
                loop_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                round INTEGER NOT NULL,
                instruction TEXT NOT NULL,
                worker_output TEXT,
                verdict TEXT,
                status TEXT NOT NULL DEFAULT 'instructed',
                started_at INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (loop_id) REFERENCES review_loops(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_review_rounds_loop
                ON review_rounds(loop_id, round);
            CREATE INDEX IF NOT EXISTS idx_review_rounds_namespace
                ON review_rounds(namespace);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_review_rounds_loop_round
                ON review_rounds(loop_id, round);
        `)
    }

    private migrateLegacySchemaIfNeeded(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            return
        }

        const hasDaemon = columns.has('daemon_state') || columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') || columns.has('runner_state_version')

        if (hasDaemon && hasRunner) {
            throw new Error('SQLite schema has both daemon_state and runner_state columns in machines; manual cleanup required.')
        }

        if (hasDaemon && !hasRunner) {
            this.migrateFromV1ToV2()
        }
    }

    private migrateFromV1ToV2(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            throw new Error('SQLite schema missing machines table for v1 to v2 migration.')
        }

        const hasDaemon = columns.has('daemon_state') && columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') && columns.has('runner_state_version')

        if (hasRunner && !hasDaemon) {
            return
        }

        if (!hasDaemon) {
            throw new Error('SQLite schema missing daemon_state columns for v1 to v2 migration.')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state TO runner_state')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state_version TO runner_state_version')
            this.db.exec('COMMIT')
            return
        } catch (error) {
            this.db.exec('ROLLBACK')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE machines_new (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    metadata TEXT,
                    metadata_version INTEGER DEFAULT 1,
                    runner_state TEXT,
                    runner_state_version INTEGER DEFAULT 1,
                    active INTEGER DEFAULT 0,
                    active_at INTEGER,
                    seq INTEGER DEFAULT 0
                );
            `)
            this.db.exec(`
                INSERT INTO machines_new (
                    id, namespace, created_at, updated_at,
                    metadata, metadata_version,
                    runner_state, runner_state_version,
                    active, active_at, seq
                )
                SELECT id, namespace, created_at, updated_at,
                       metadata, metadata_version,
                       daemon_state, daemon_state_version,
                       active, active_at, seq
                FROM machines;
            `)
            this.db.exec('DROP TABLE machines')
            this.db.exec('ALTER TABLE machines_new RENAME TO machines')
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace)')
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v1->v2 failed: ${message}`)
        }
    }

    private migrateFromV2ToV3(): void {
        return
    }

    private migrateFromV3ToV4(): void {
        const sessionColumns = this.getSessionColumnNames()
        try {
            this.db.exec('BEGIN')

            if (!sessionColumns.has('preview_url')) {
                this.db.exec('ALTER TABLE sessions ADD COLUMN preview_url TEXT')
            }

            this.db.exec(`
                CREATE TABLE IF NOT EXISTS preview_url_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    namespace TEXT NOT NULL,
                    url TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    last_used_at INTEGER NOT NULL,
                    UNIQUE(namespace, url)
                );
            `)
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_preview_url_history_namespace_last_used
                ON preview_url_history(namespace, last_used_at DESC)
            `)
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS groups (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    name TEXT NOT NULL,
                    description TEXT,
                    note_session_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_groups_namespace ON groups(namespace);

                CREATE TABLE IF NOT EXISTS group_members (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_id TEXT NOT NULL,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    member_type TEXT NOT NULL,
                    session_id TEXT,
                    user_id INTEGER,
                    role TEXT NOT NULL DEFAULT 'member',
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
                CREATE INDEX IF NOT EXISTS idx_group_members_namespace ON group_members(namespace);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_dedupe
                    ON group_members(group_id, member_type, session_id, user_id);

                CREATE TABLE IF NOT EXISTS group_messages (
                    id TEXT PRIMARY KEY,
                    group_id TEXT NOT NULL,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    seq INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    trace_id TEXT,
                    task_id TEXT,
                    source TEXT NOT NULL,
                    actor_session_id TEXT,
                    actor_name TEXT,
                    target_session_ids TEXT,
                    quoted_message_id TEXT,
                    payload TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_group_messages_group_seq
                    ON group_messages(group_id, seq);
                CREATE INDEX IF NOT EXISTS idx_group_messages_namespace_created
                    ON group_messages(namespace, created_at DESC);

                CREATE TABLE IF NOT EXISTS group_tasks (
                    id TEXT PRIMARY KEY,
                    group_id TEXT NOT NULL,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    trace_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    target_session_id TEXT NOT NULL,
                    command TEXT NOT NULL,
                    status TEXT NOT NULL,
                    dedupe_key TEXT,
                    expires_at INTEGER,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    started_at INTEGER,
                    completed_at INTEGER,
                    error TEXT,
                    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                    FOREIGN KEY (target_session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_group_tasks_group_status
                    ON group_tasks(group_id, status);
                CREATE INDEX IF NOT EXISTS idx_group_tasks_namespace_created
                    ON group_tasks(namespace, created_at DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_group_tasks_dedupe_key
                    ON group_tasks(group_id, dedupe_key)
                    WHERE dedupe_key IS NOT NULL;

                CREATE TABLE IF NOT EXISTS group_notes (
                    group_id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    content TEXT NOT NULL DEFAULT '',
                    version INTEGER NOT NULL DEFAULT 1,
                    updated_by TEXT,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_group_notes_namespace ON group_notes(namespace);
            `)
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v3->v4 failed: ${message}`)
        }
    }

    private migrateFromV4ToV5(): void {
        const groupMessageColumns = this.getGroupMessageColumnNames()
        if (groupMessageColumns.size === 0) {
            return
        }

        try {
            this.db.exec('BEGIN')
            if (!groupMessageColumns.has('quoted_message_id')) {
                this.db.exec('ALTER TABLE group_messages ADD COLUMN quoted_message_id TEXT')
            }
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v4->v5 failed: ${message}`)
        }
    }

    private migrateFromV5ToV6(): void {
        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS project_offline_preferences (
                    namespace TEXT NOT NULL DEFAULT 'default',
                    user_id INTEGER NOT NULL,
                    directory TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (namespace, user_id, directory),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            `)
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_project_offline_preferences_namespace_user
                    ON project_offline_preferences(namespace, user_id, updated_at DESC)
            `)
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v5->v6 failed: ${message}`)
        }
    }

    private migrateFromV6ToV7(): void {
        try {
            this.db.exec('BEGIN')
            createConversationTurnsSchema(this.db)
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v6->v7 failed: ${message}`)
        }

        try {
            this.db.exec('BEGIN')
            const turnStore = new TurnStore(this.db)
            turnStore.rebuildAllTurns()
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite conversation turn backfill failed during v6->v7 migration: ${message}`)
        }
    }

    private migrateFromV7ToV8(): void {
        try {
            this.db.exec('BEGIN')
            createGroupConversationTurnsSchema(this.db)
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v7->v8 failed: ${message}`)
        }

        if (!this.hasTable('groups') || !this.hasTable('group_messages')) {
            return
        }

        try {
            this.db.exec('BEGIN')
            const groupStore = new GroupStore(this.db)
            groupStore.rebuildAllGroupConversationTurns()
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite group conversation turn backfill failed during v7->v8 migration: ${message}`)
        }
    }

    private migrateFromV8ToV9(): void {
        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS reports (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    session_id TEXT,
                    task_id TEXT,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'unknown',
                    markdown TEXT NOT NULL DEFAULT '',
                    metadata TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_reports_namespace_updated
                    ON reports(namespace, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_reports_session_namespace
                    ON reports(session_id, namespace);

                CREATE TABLE IF NOT EXISTS report_assets (
                    id TEXT PRIMARY KEY,
                    report_id TEXT NOT NULL,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    file_name TEXT NOT NULL,
                    storage_key TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    caption TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_report_assets_report
                    ON report_assets(report_id, created_at ASC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_report_assets_storage_key
                    ON report_assets(report_id, storage_key);

                CREATE TABLE IF NOT EXISTS report_shares (
                    id TEXT PRIMARY KEY,
                    report_id TEXT NOT NULL,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    token TEXT NOT NULL UNIQUE,
                    created_by TEXT,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER,
                    revoked_at INTEGER,
                    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_report_shares_report
                    ON report_shares(report_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_report_shares_token
                    ON report_shares(token);
            `)
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v8->v9 failed: ${message}`)
        }
    }

    private migrateFromV9ToV10(): void {
        try {
            this.db.exec('BEGIN')

            if (this.hasTable('sessions') && this.hasTable('messages') && this.hasTable('conversation_turns')) {
                const turnStore = new TurnStore(this.db)
                turnStore.rebuildAllTurns()
            }

            if (this.hasTable('groups') && this.hasTable('group_messages') && this.hasTable('group_conversation_turns')) {
                const groupStore = new GroupStore(this.db)
                groupStore.rebuildAllGroupConversationTurns()
            }

            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite conversation preview refresh failed during v9->v10 migration: ${message}`)
        }
    }

    private migrateFromV10ToV11(): void {
        try {
            this.db.exec('BEGIN')

            if (this.hasTable('sessions') && this.hasTable('messages') && this.hasTable('conversation_turns')) {
                const turnStore = new TurnStore(this.db)
                turnStore.rebuildAllTurns()
            }

            if (this.hasTable('groups') && this.hasTable('group_messages') && this.hasTable('group_conversation_turns')) {
                const groupStore = new GroupStore(this.db)
                groupStore.rebuildAllGroupConversationTurns()
            }

            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite conversation preview indentation refresh failed during v10->v11 migration: ${message}`)
        }
        const columns = this.getSessionColumnNames()
        if (!columns.has('team_state')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state TEXT')
        }
        if (!columns.has('team_state_updated_at')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state_updated_at INTEGER')
        }
    }

    private migrateFromV11ToV12(): void {
        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS review_loops (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    worker_session_id TEXT NOT NULL,
                    reviewer_session_id TEXT NOT NULL,
                    requirement TEXT NOT NULL,
                    acceptance_criteria TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'executing',
                    user_preference TEXT NOT NULL DEFAULT 'auto',
                    current_round INTEGER NOT NULL DEFAULT 0,
                    max_rounds INTEGER NOT NULL DEFAULT 10,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (worker_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                    FOREIGN KEY (reviewer_session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_review_loops_namespace
                    ON review_loops(namespace);
                CREATE INDEX IF NOT EXISTS idx_review_loops_namespace_status
                    ON review_loops(namespace, status);

                CREATE TABLE IF NOT EXISTS review_rounds (
                    id TEXT PRIMARY KEY,
                    loop_id TEXT NOT NULL,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    round INTEGER NOT NULL,
                    instruction TEXT NOT NULL,
                    worker_output TEXT,
                    verdict TEXT,
                    status TEXT NOT NULL DEFAULT 'instructed',
                    started_at INTEGER NOT NULL,
                    completed_at INTEGER,
                    FOREIGN KEY (loop_id) REFERENCES review_loops(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_review_rounds_loop
                    ON review_rounds(loop_id, round);
                CREATE INDEX IF NOT EXISTS idx_review_rounds_namespace
                    ON review_rounds(namespace);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_review_rounds_loop_round
                    ON review_rounds(loop_id, round);
            `)
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v11->v12 failed: ${message}`)
        }
    }

    private migrateFromV12ToV13(): void {
        // Turn previews before v13 were built by blindly crawling message
        // JSON, which pulled in tool output and model ids. Rebuild them all
        // with the strict assistant-text-only extractor.
        try {
            this.db.exec('BEGIN')
            const turnStore = new TurnStore(this.db)
            turnStore.rebuildAllTurns()
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite conversation turn preview rebuild failed during v12->v13 migration: ${message}`)
        }
    }

    private getSessionColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMachineColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(machines)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getGroupMessageColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(group_messages)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getUserVersion(): number {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number): void {
        this.db.exec(`PRAGMA user_version = ${version}`)
    }

    private hasAnyUserTables(): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).get() as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private hasTable(name: string): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
        ).get(name) as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private ensureRequiredTablesPresent(): void {
        const missingBeforeRepair = this.getMissingRequiredTables()
        if (missingBeforeRepair.length === 0) {
            return
        }

        // Self-heal partial upgrades where user_version was bumped but
        // table creation did not complete (e.g. interrupted startup).
        this.createSchema()

        const missingAfterRepair = this.getMissingRequiredTables()
        if (missingAfterRepair.length === 0) {
            return
        }

        throw new Error(
            `SQLite schema is missing required tables (${missingAfterRepair.join(', ')}). ` +
            'Automatic schema repair was attempted and failed. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }

    private ensureGroupMessageColumnsPresent(): void {
        const groupMessageColumns = this.getGroupMessageColumnNames()
        if (groupMessageColumns.size === 0 || groupMessageColumns.has('quoted_message_id')) {
            return
        }

        this.db.exec('ALTER TABLE group_messages ADD COLUMN quoted_message_id TEXT')
    }

    private getMissingRequiredTables(): string[] {
        const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
        const rows = this.db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REQUIRED_TABLES) as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        return REQUIRED_TABLES.filter((table) => !existing.has(table))
    }

    private buildSchemaMismatchError(currentVersion: number): Error {
        const location = (this.dbPath === ':memory:' || this.dbPath.startsWith('file::memory:'))
            ? 'in-memory database'
            : this.dbPath
        return new Error(
            `SQLite schema version mismatch for ${location}. ` +
            `Expected ${SCHEMA_VERSION}, found ${currentVersion}. ` +
            'This build does not run compatibility migrations. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }
}
