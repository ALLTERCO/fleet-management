import {mount} from '@vue/test-utils';
import {defineComponent, h, nextTick, ref} from 'vue';
import {describe, expect, it, vi} from 'vitest';
import {
    type FetchPage,
    useListSource
} from '@/composables/useListSource';

interface Row {
    id: number;
    name: string;
}

function makeRows(n: number, offset = 0): Row[] {
    return Array.from({length: n}, (_, i) => ({
        id: offset + i + 1,
        name: `r${offset + i + 1}`
    }));
}

function clientSliceFetcher(
    full: Row[],
    options: {total?: boolean; cursor?: boolean} = {}
): FetchPage<Row> {
    const useTotal = options.total ?? true;
    const useCursor = options.cursor ?? true;
    return async ({cursor, pageSize}) => {
        const start = cursor ? Number(cursor) : 0;
        const end = Math.min(full.length, start + pageSize);
        const slice = full.slice(start, end);
        const nextCursor =
            useCursor && end < full.length ? String(end) : null;
        return {
            items: slice,
            nextCursor,
            ...(useTotal ? {total: cursor === null ? full.length : undefined} : {})
        };
    };
}

async function mountWith<T>(setup: () => T): Promise<T> {
    let result!: T;
    const Comp = defineComponent({
        setup() {
            result = setup();
            return () => h('div');
        }
    });
    const wrapper = mount(Comp);
    await nextTick();
    await nextTick();
    void wrapper;
    return result;
}

describe('useListSource — pages mode', () => {
    it('loads page 1 on mount so the first list paint has data without a manual call', async () => {
        const fetcher = vi.fn(clientSliceFetcher(makeRows(120)));
        const src = await mountWith(() =>
            useListSource<Row>(fetcher, {pageSize: 50, mode: 'pages'})
        );
        expect(src.page.value).toBe(1);
        expect(src.pageItems.value.length).toBe(50);
        expect(src.pageItems.value[0]?.id).toBe(1);
        expect(src.total.value).toBe(120);
        expect(src.pageCount.value).toBe(3);
    });

    it('goToPage(3) fetches enough chunks so the requested window has data — no holes between rows', async () => {
        const src = await mountWith(() =>
            useListSource<Row>(clientSliceFetcher(makeRows(120)), {
                pageSize: 50,
                mode: 'pages'
            })
        );
        src.goToPage(3);
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        await nextTick();
        expect(src.page.value).toBe(3);
        expect(src.pageItems.value[0]?.id).toBe(101);
        expect(src.pageItems.value.length).toBe(20);
    });

    it('setPageSize resets to page 1 and reloads so older offsets cannot leak into a new window size', async () => {
        const src = await mountWith(() =>
            useListSource<Row>(clientSliceFetcher(makeRows(200)), {
                pageSize: 50,
                mode: 'pages'
            })
        );
        src.goToPage(2);
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        src.setPageSize(100);
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        expect(src.pageSize.value).toBe(100);
        expect(src.page.value).toBe(1);
        expect(src.pageItems.value[0]?.id).toBe(1);
        expect(src.pageCount.value).toBe(2);
    });

    it('reports pageCount from total when total is present so the last-page button knows its target', async () => {
        const src = await mountWith(() =>
            useListSource<Row>(clientSliceFetcher(makeRows(127)), {
                pageSize: 50,
                mode: 'pages'
            })
        );
        expect(src.pageCount.value).toBe(3);
    });

    it('uses the chunk-as-page mapping so a server short page lines up cleanly on the next page', async () => {
        // Fetcher returns 30 / 50 / 50 / 30 — neither aligned to pageSize.
        // A flat-slice impl would mis-window page 2 by 20 rows; chunk-as-page
        // must return the rows the server actually delivered for each page.
        const sizes = [30, 50, 50, 30];
        let call = 0;
        const fetcher: FetchPage<Row> = ({cursor}) => {
            const idx = cursor ? Number(cursor) : 0;
            const start = sizes.slice(0, call).reduce((a, b) => a + b, 0);
            const chunk = makeRows(sizes[call], start);
            call += 1;
            const next = idx + sizes[call - 1];
            const hasMore = call < sizes.length;
            return Promise.resolve({
                items: chunk,
                nextCursor: hasMore ? String(next) : null,
                total: cursor === null ? 160 : undefined
            });
        };
        const src = await mountWith(() =>
            useListSource<Row>(fetcher, {pageSize: 50, mode: 'pages'})
        );
        // Page 1 returned a short chunk of 30; the page UI should show exactly
        // those 30, not borrow from page 2's chunk to backfill.
        expect(src.pageItems.value.length).toBe(30);
        expect(src.pageItems.value[0]?.id).toBe(1);
        src.goToPage(2);
        for (let i = 0; i < 5; i++) {
            await nextTick();
            await new Promise((r) => setTimeout(r, 0));
        }
        expect(src.pageItems.value.length).toBe(50);
        expect(src.pageItems.value[0]?.id).toBe(31);
    });
});

describe('useListSource — infinite mode', () => {
    it('loadMore appends the next chunk so scrolling never replaces previously-rendered rows', async () => {
        const src = await mountWith(() =>
            useListSource<Row>(clientSliceFetcher(makeRows(75)), {
                pageSize: 25,
                mode: 'infinite'
            })
        );
        expect(src.items.value.length).toBe(25);
        await src.loadMore();
        expect(src.items.value.length).toBe(50);
        await src.loadMore();
        expect(src.items.value.length).toBe(75);
    });

    it('stops calling loadMore once the cursor returns null so the network is not poked past the end of the data', async () => {
        const fetcher = vi.fn(clientSliceFetcher(makeRows(40)));
        const src = await mountWith(() =>
            useListSource<Row>(fetcher, {pageSize: 25, mode: 'infinite'})
        );
        await src.loadMore();
        const callsAfterEnd = fetcher.mock.calls.length;
        await src.loadMore();
        await src.loadMore();
        expect(fetcher.mock.calls.length).toBe(callsAfterEnd);
        expect(src.hasMore.value).toBe(false);
    });
});

describe('useListSource — search', () => {
    it('refreshes from cursor null when search changes so the first page reflects the new query', async () => {
        const fetcher = vi.fn(clientSliceFetcher(makeRows(50)));
        const search = ref('');
        const src = await mountWith(() =>
            useListSource<Row>(fetcher, {
                pageSize: 25,
                mode: 'pages',
                search
            })
        );
        const callsBefore = fetcher.mock.calls.length;
        search.value = 'foo';
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        await nextTick();
        expect(fetcher.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(fetcher.mock.calls.at(-1)?.[0].cursor).toBeNull();
        void src;
    });
});
