import {
    computed,
    onBeforeUnmount,
    onMounted,
    type Ref,
    ref,
    shallowRef,
    watch
} from 'vue';

export interface FetchPageArgs {
    cursor: string | null;
    pageSize: number;
    search: string;
    signal: AbortSignal;
    // Optional page hint for random-access backends; cursor wins if both set.
    page?: number;
}

export interface FetchPageResult<T> {
    items: T[];
    nextCursor: string | null;
    total?: number;
}

export type FetchPage<T> = (args: FetchPageArgs) => Promise<FetchPageResult<T>>;

export type PaginationMode = 'pages' | 'infinite';

export interface UseListSourceOptions {
    pageSize?: number;
    mode?: PaginationMode;
    search?: Ref<string>;
    urlKey?: string | null;
}

export interface UseListSource<T> {
    items: Ref<readonly T[]>;
    pageItems: Ref<readonly T[]>;
    loading: Ref<boolean>;
    error: Ref<unknown>;
    total: Ref<number | null>;
    page: Ref<number>;
    pageSize: Ref<number>;
    pageCount: Ref<number>;
    hasMore: Ref<boolean>;
    goToPage: (next: number) => void;
    setPageSize: (next: number) => void;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;
}

interface Chunk<T> {
    cursor: string | null;
    items: T[];
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MODE: PaginationMode = 'infinite';

// ── URL sync (Answer + Do, isolated side effects) ────────────────────────

function readUrlPage(key: string): number {
    if (typeof window === 'undefined') return 1;
    const raw = new URLSearchParams(window.location.search).get(key);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function writeUrlPage(key: string, page: number): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (page <= 1) url.searchParams.delete(key);
    else url.searchParams.set(key, String(page));
    window.history.replaceState({}, '', url.toString());
}

// ── Pure Answer helpers ──────────────────────────────────────────────────

function isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
}

function flatten<T>(chunks: readonly Chunk<T>[]): T[] {
    return chunks.flatMap((c) => c.items);
}

function emptyChunk<T>(): Chunk<T> {
    return {cursor: null, items: []};
}

function isFirstFetch<T>(chunks: readonly Chunk<T>[]): boolean {
    return chunks.length === 1 && chunks[0].items.length === 0;
}

function nextCursorOf<T>(chunks: readonly Chunk<T>[]): string | null {
    if (isFirstFetch(chunks)) return null;
    return chunks[chunks.length - 1]?.cursor ?? null;
}

function totalFromResult<T>(
    result: FetchPageResult<T>,
    fallbackToCount: boolean
): number | null {
    if (typeof result.total === 'number') return result.total;
    if (fallbackToCount && result.nextCursor === null)
        return result.items.length;
    return null;
}

// ── Composable ───────────────────────────────────────────────────────────

export function useListSource<T>(
    fetchPage: FetchPage<T>,
    options: UseListSourceOptions = {}
): UseListSource<T> {
    const mode = options.mode ?? DEFAULT_MODE;
    const urlKey = options.urlKey ?? null;
    const search = options.search ?? ref('');
    const pageSize = ref(options.pageSize ?? DEFAULT_PAGE_SIZE);
    const pageKey = urlKey ? `${urlKey}_page` : null;
    const page = ref(pageKey ? readUrlPage(pageKey) : 1);

    const chunks = shallowRef<Chunk<T>[]>([emptyChunk<T>()]);
    const total = ref<number | null>(null);
    const loading = ref(false);
    const error = ref<unknown>(null);

    let inflight: AbortController | null = null;
    let lastSearch = search.value;

    const items = computed<readonly T[]>(() => flatten(chunks.value));

    const pageCount = computed(() => {
        if (total.value === null) return 0;
        return Math.max(1, Math.ceil(total.value / pageSize.value));
    });

    const hasMore = computed(() => {
        if (isFirstFetch(chunks.value)) return true;
        if (nextCursorOf(chunks.value) !== null) return true;
        if (total.value === null) return false;
        return items.value.length < total.value;
    });

    const pageItems = computed<readonly T[]>(() => {
        if (mode === 'infinite') return items.value;
        // One chunk == one page. Slicing a flat items[] drifts when a
        // backend returns short pages; chunk-indexed lookup doesn't.
        const chunk = chunks.value[page.value - 1];
        return chunk?.items ?? [];
    });

    // ── Do helpers — single side effect each ──

    function clearError(): void {
        error.value = null;
    }

    function resetState(): void {
        inflight?.abort();
        inflight = null;
        chunks.value = [emptyChunk<T>()];
        total.value = null;
        clearError();
        if (mode === 'pages') {
            page.value = 1;
            if (pageKey) writeUrlPage(pageKey, 1);
        }
    }

    function replaceWithFirstChunk(result: FetchPageResult<T>): void {
        chunks.value = [{cursor: result.nextCursor, items: result.items}];
        total.value = totalFromResult(result, true);
    }

    function appendChunk(result: FetchPageResult<T>): void {
        chunks.value = [
            ...chunks.value,
            {cursor: result.nextCursor, items: result.items}
        ];
    }

    function storeResult(
        cursorUsed: string | null,
        result: FetchPageResult<T>
    ): void {
        if (cursorUsed === null) replaceWithFirstChunk(result);
        else appendChunk(result);
    }

    function startFetch(): AbortController {
        inflight?.abort();
        const controller = new AbortController();
        inflight = controller;
        loading.value = true;
        return controller;
    }

    function endFetch(): void {
        loading.value = false;
        inflight = null;
    }

    // ── Fetch orchestration — top-down narrative ──

    async function fetchOne(
        cursor: string | null,
        pageHint?: number
    ): Promise<void> {
        const controller = startFetch();
        try {
            const result = await fetchPage({
                cursor,
                pageSize: pageSize.value,
                search: search.value,
                signal: controller.signal,
                page: pageHint
            });
            storeResult(cursor, result);
            clearError();
        } catch (err) {
            handleFetchError(err);
        } finally {
            endFetch();
        }
    }

    function handleFetchError(err: unknown): void {
        if (isAbortError(err)) return;
        error.value = err;
    }

    async function fetchNext(): Promise<void> {
        if (loading.value) return;
        if (!hasMore.value) return;
        await fetchOne(nextCursorOf(chunks.value));
    }

    async function fillUpToPage(): Promise<void> {
        if (mode !== 'pages') return;
        // Sequential; cheap for clientSliceFetcher, N round trips for a backend.
        while (loadedPageCount() < page.value && hasMore.value) {
            const before = loadedPageCount();
            await fetchNext();
            if (loadedPageCount() === before) return;
        }
    }

    function loadedPageCount(): number {
        if (isFirstFetch(chunks.value)) return 0;
        return chunks.value.length;
    }

    async function loadInitial(): Promise<void> {
        if (mode === 'infinite') return fetchNext();
        return fillUpToPage();
    }

    // ── Public Do API ──

    function goToPage(next: number): void {
        if (mode !== 'pages') return;
        const target = Math.max(1, next);
        page.value = target;
        if (pageKey) writeUrlPage(pageKey, target);
        void fillUpToPage();
    }

    function setPageSize(next: number): void {
        if (next < 1 || next === pageSize.value) return;
        pageSize.value = next;
        resetState();
        void loadInitial();
    }

    async function loadMore(): Promise<void> {
        if (mode !== 'infinite') return;
        await fetchNext();
    }

    async function refresh(): Promise<void> {
        resetState();
        await loadInitial();
    }

    // ── Reactivity wiring ──

    watch(search, (next) => {
        if (next === lastSearch) return;
        lastSearch = next;
        void refresh();
    });

    onMounted(() => {
        void loadInitial();
    });

    onBeforeUnmount(() => {
        inflight?.abort();
    });

    return {
        items,
        pageItems,
        loading,
        error,
        total,
        page,
        pageSize,
        pageCount,
        hasMore,
        goToPage,
        setPageSize,
        loadMore,
        refresh
    };
}
