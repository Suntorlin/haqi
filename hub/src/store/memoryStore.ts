import type { Database } from 'bun:sqlite'

import {
    addMemoryEvent,
    addMemoryTags,
    approvedMemoryIds,
    memoryIdsBackedByUser,
    addMemoryLink,
    deleteMemory,
    getMemory,
    getMemoryEvent,
    hasMemoryEventWithHash,
    hasReplacement,
    insertMemory,
    listMemories,
    listMemoryEvents,
    listMemoryEventsSince,
    listMemoryLinks,
    listMemoryVectors,
    listMergeEvents,
    listUserTurns,
    mentionStats,
    removeMemoryLink,
    setMemoryChecked,
    setMemoryEventAction,
    setMemoryVector,
    updateMemory,
    type MemoryPatch,
    type NewMemory,
    type NewMemoryEvent,
    type StoredVector,
    type UserTurn
} from './memories'
import type { StoredMemory, StoredMemoryEvent, StoredMemoryLink } from './types'

export class MemoryStore {
    constructor(private readonly db: Database) {}

    insert(input: NewMemory): StoredMemory { return insertMemory(this.db, input) }
    get(id: string, namespace: string): StoredMemory | null { return getMemory(this.db, id, namespace) }
    list(namespace: string): StoredMemory[] { return listMemories(this.db, namespace) }
    update(id: string, namespace: string, patch: MemoryPatch): StoredMemory | null { return updateMemory(this.db, id, namespace, patch) }
    delete(id: string, namespace: string): boolean { return deleteMemory(this.db, id, namespace) }
    link(namespace: string, fromId: string, toId: string): void { addMemoryLink(this.db, namespace, fromId, toId) }
    unlink(namespace: string, fromId: string, toId: string): void { removeMemoryLink(this.db, namespace, fromId, toId) }
    links(namespace: string): StoredMemoryLink[] { return listMemoryLinks(this.db, namespace) }
    addEvent(input: NewMemoryEvent): StoredMemoryEvent { return addMemoryEvent(this.db, input) }
    event(id: string, namespace: string): StoredMemoryEvent | null { return getMemoryEvent(this.db, id, namespace) }
    setEventAction(id: string, namespace: string, action: string): void { setMemoryEventAction(this.db, id, namespace, action) }
    merges(namespace: string): StoredMemoryEvent[] { return listMergeEvents(this.db, namespace) }
    events(namespace: string, limit: number): StoredMemoryEvent[] { return listMemoryEvents(this.db, namespace, limit) }
    eventsSince(namespace: string, since: number): StoredMemoryEvent[] { return listMemoryEventsSince(this.db, namespace, since) }
    hasEventHash(namespace: string, hash: string): boolean { return hasMemoryEventWithHash(this.db, namespace, hash) }
    mentions(namespace: string, since: number): Map<string, { recent: number; lastAt: number }> { return mentionStats(this.db, namespace, since) }
    approved(namespace: string): Set<string> { return approvedMemoryIds(this.db, namespace) }
    backedByUser(namespace: string): Set<string> { return memoryIdsBackedByUser(this.db, namespace) }
    userTurns(namespace: string, since: number, limit: number): UserTurn[] { return listUserTurns(this.db, namespace, since, limit) }
    hasReplacement(namespace: string, id: string): boolean { return hasReplacement(this.db, namespace, id) }
    setVector(namespace: string, vector: StoredVector): void { setMemoryVector(this.db, namespace, vector) }
    vectors(namespace: string): StoredVector[] { return listMemoryVectors(this.db, namespace) }
    addTags(namespace: string, memoryId: string, tags: string[]): void { addMemoryTags(this.db, namespace, memoryId, tags) }
    setChecked(namespace: string, memoryId: string, checked: string): void { setMemoryChecked(this.db, namespace, memoryId, checked) }
}
