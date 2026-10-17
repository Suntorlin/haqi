import type { Database } from 'bun:sqlite'

import {
    addMemoryEvent,
    addMemoryLink,
    deleteMemory,
    getMemory,
    hasMemoryEventWithHash,
    insertMemory,
    listMemories,
    listMemoryEvents,
    listMemoryEventsSince,
    listMemoryLinks,
    updateMemory,
    type MemoryPatch,
    type NewMemory,
    type NewMemoryEvent
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
    links(namespace: string): StoredMemoryLink[] { return listMemoryLinks(this.db, namespace) }
    addEvent(input: NewMemoryEvent): StoredMemoryEvent { return addMemoryEvent(this.db, input) }
    events(namespace: string, limit: number): StoredMemoryEvent[] { return listMemoryEvents(this.db, namespace, limit) }
    eventsSince(namespace: string, since: number): StoredMemoryEvent[] { return listMemoryEventsSince(this.db, namespace, since) }
    hasEventHash(namespace: string, hash: string): boolean { return hasMemoryEventWithHash(this.db, namespace, hash) }
}
