import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it} from 'vitest';

import {useLogStore} from '@/stores/console';

function addEntry(
    store: ReturnType<typeof useLogStore>,
    level: string,
    category?: string
) {
    store.addLog(`[${level}]`, `msg-${level}`, '#fff', category);
}

describe('logStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    describe('addLog / buffer cap', () => {
        it('parses the level from the colored part', () => {
            const store = useLogStore();
            addEntry(store, 'ERROR');
            expect(store.logs[0].level).toBe('ERROR');
        });

        it('falls back to INFO when level cannot be parsed', () => {
            const store = useLogStore();
            store.addLog('[unknown]', 'msg', '#fff');
            expect(store.logs[0].level).toBe('INFO');
        });
    });

    describe('knownCategories', () => {
        it('deduplicates and sorts categories seen in the buffer', () => {
            const store = useLogStore();
            addEntry(store, 'INFO', 'banana');
            addEntry(store, 'INFO', 'apple');
            addEntry(store, 'INFO', 'banana');
            expect(store.knownCategories).toEqual(['apple', 'banana']);
        });

        it('omits log entries without a category', () => {
            const store = useLogStore();
            addEntry(store, 'INFO');
            addEntry(store, 'INFO', 'apple');
            expect(store.knownCategories).toEqual(['apple']);
        });

        it('caps at LOG_CATEGORY_MAX distinct categories', async () => {
            const {LOG_CATEGORY_MAX} = await import('@/constants');
            const store = useLogStore();
            for (let i = 0; i < LOG_CATEGORY_MAX + 50; i++) {
                addEntry(store, 'INFO', `cat-${String(i).padStart(4, '0')}`);
            }
            expect(store.knownCategories.length).toBe(LOG_CATEGORY_MAX);
        });
    });

    describe('filteredLogs', () => {
        it('returns all logs when filter=ALL and no categories are selected', () => {
            const store = useLogStore();
            addEntry(store, 'INFO', 'a');
            addEntry(store, 'ERROR', 'b');
            expect(store.filteredLogs).toHaveLength(2);
        });

        it('filters by level when setFilter is called', () => {
            const store = useLogStore();
            addEntry(store, 'INFO', 'a');
            addEntry(store, 'ERROR', 'b');
            store.setFilter('ERROR');
            expect(store.filteredLogs).toHaveLength(1);
            expect(store.filteredLogs[0].level).toBe('ERROR');
        });

        it('intersects active categories with the filter', () => {
            const store = useLogStore();
            addEntry(store, 'INFO', 'a');
            addEntry(store, 'INFO', 'b');
            store.toggleCategory('a');
            expect(store.filteredLogs.map((l) => l.category)).toEqual(['a']);
        });

        it('treats empty active-categories set as "all allowed"', () => {
            const store = useLogStore();
            addEntry(store, 'INFO', 'a');
            addEntry(store, 'INFO', 'b');
            expect(store.activeCategories.size).toBe(0);
            expect(store.filteredLogs).toHaveLength(2);
        });
    });

    describe('toggleCategory', () => {
        it('adds a category when missing and removes when present', () => {
            const store = useLogStore();
            store.toggleCategory('a');
            expect(store.activeCategories.has('a')).toBe(true);
            store.toggleCategory('a');
            expect(store.activeCategories.has('a')).toBe(false);
        });
    });

    describe('clearLogs', () => {
        it('drops all entries and pins', () => {
            const store = useLogStore();
            addEntry(store, 'INFO', 'a');
            store.togglePin(store.logs[0].ts);
            store.clearLogs();
            expect(store.logs).toHaveLength(0);
            expect(store.pinnedLogTimestamps.size).toBe(0);
        });

        it('resets activeCategories so stale filters cannot hide new logs', () => {
            const store = useLogStore();
            addEntry(store, 'INFO', 'a');
            store.toggleCategory('a');
            expect(store.activeCategories.size).toBe(1);
            store.clearLogs();
            expect(store.activeCategories.size).toBe(0);
        });
    });

    describe('pin state', () => {
        it('toggles pin set on togglePin', () => {
            const store = useLogStore();
            addEntry(store, 'INFO');
            const ts = store.logs[0].ts;
            store.togglePin(ts);
            expect(store.isPinned(ts)).toBe(true);
            store.togglePin(ts);
            expect(store.isPinned(ts)).toBe(false);
        });

        it('clearPins empties the set without touching logs', () => {
            const store = useLogStore();
            addEntry(store, 'INFO');
            store.togglePin(store.logs[0].ts);
            store.clearPins();
            expect(store.pinnedLogTimestamps.size).toBe(0);
            expect(store.logs).toHaveLength(1);
        });
    });

    describe('formatLogsForExport', () => {
        it('renders level + category + message in order', () => {
            const store = useLogStore();
            addEntry(store, 'WARN', 'net');
            const out = store.formatLogsForExport(store.logs);
            expect(out).toContain('[WARN]');
            expect(out).toContain('[net]');
            expect(out).toContain('msg-WARN');
        });
    });
});
