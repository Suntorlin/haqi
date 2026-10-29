import { describe, expect, it } from 'vitest';
import { AppServerEventConverter } from '../utils/appServerEventConverter';

describe('AppServerEventConverter: context compaction items', () => {
    it('emits context_compacted when the compaction item completes', () => {
        const converter = new AppServerEventConverter();
        const started = converter.handleNotification('item/started', {
            item: { id: 'item-1', type: 'contextCompaction' }
        });
        expect(started.map((event) => event.type)).toEqual(['tool_call_begin']);

        const completed = converter.handleNotification('item/completed', {
            item: { id: 'item-1', type: 'contextCompaction' }
        });
        expect(completed.map((event) => event.type)).toEqual(['tool_call_end', 'context_compacted']);
    });

    it('still maps thread/compacted to context_compacted', () => {
        const converter = new AppServerEventConverter();
        const events = converter.handleNotification('thread/compacted', { threadId: 'thread-1' });
        expect(events.map((event) => event.type)).toEqual(['context_compacted']);
    });
});
