import {ref} from 'vue';
import {describe, expect, it} from 'vitest';
import {clientSliceFetcher} from '@/composables/clientSliceFetcher';

interface Row {
    id: number;
}

function rows(n: number): Row[] {
    return Array.from({length: n}, (_, i) => ({id: i + 1}));
}

const noSignal = new AbortController().signal;

describe('clientSliceFetcher — adapts a local list into the FetchPage contract', () => {
    it('returns total only on the first call so the header reads "X of N" without paying for it twice', async () => {
        const source = ref<Row[]>(rows(120));
        const fetch = clientSliceFetcher(source);
        const first = await fetch({
            cursor: null,
            pageSize: 50,
            search: '',
            signal: noSignal
        });
        const second = await fetch({
            cursor: first.nextCursor,
            pageSize: 50,
            search: '',
            signal: noSignal
        });
        expect(first.total).toBe(120);
        expect(second.total).toBeUndefined();
    });

    it('advances the cursor by chunk size so successive calls never repeat or skip rows', async () => {
        const source = ref<Row[]>(rows(60));
        const fetch = clientSliceFetcher(source);
        const a = await fetch({
            cursor: null,
            pageSize: 25,
            search: '',
            signal: noSignal
        });
        const b = await fetch({
            cursor: a.nextCursor,
            pageSize: 25,
            search: '',
            signal: noSignal
        });
        expect(a.items.map((r) => r.id)).toEqual(rows(25).map((r) => r.id));
        expect(b.items[0].id).toBe(26);
    });

    it('returns nextCursor null on the final chunk so the consumer can stop polling for more', async () => {
        const source = ref<Row[]>(rows(30));
        const fetch = clientSliceFetcher(source);
        const result = await fetch({
            cursor: null,
            pageSize: 50,
            search: '',
            signal: noSignal
        });
        expect(result.nextCursor).toBeNull();
        expect(result.items).toHaveLength(30);
    });
});
