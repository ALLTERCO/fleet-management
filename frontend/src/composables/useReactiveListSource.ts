import {computed, nextTick, type Ref, ref, shallowRef, watch} from 'vue';
import type {PaginationMode, UseListSource} from './useListSource';

// `search` and `urlKey` from UseListSourceOptions don't apply — this
// composable windows an already-filtered source. Narrow the options
// surface so misuse is caught at compile time.
export type UseReactiveListSourceOptions = {
    pageSize?: number;
    mode?: PaginationMode;
};

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MODE: PaginationMode = 'infinite';

export function useReactiveListSource<T>(
    source: Ref<readonly T[]>,
    options: UseReactiveListSourceOptions = {}
): UseListSource<T> {
    const mode = options.mode ?? DEFAULT_MODE;
    const pageSize = ref(options.pageSize ?? DEFAULT_PAGE_SIZE);
    const page = ref(1);
    const loading = ref(false);
    const error = ref<unknown>(null);
    const visibleCount = ref(pageSize.value);
    const pageItems = shallowRef<readonly T[]>([]);
    let queued = false;

    const items = computed<readonly T[]>(() => source.value);
    const total = computed(() => source.value.length);
    const pageCount = computed(() =>
        Math.max(1, Math.ceil(total.value / pageSize.value))
    );
    const hasMore = computed(() =>
        mode === 'infinite'
            ? visibleCount.value < total.value
            : page.value < pageCount.value
    );

    function reslice(): void {
        if (mode === 'infinite') {
            pageItems.value = source.value.slice(0, visibleCount.value);
            return;
        }
        const start = (page.value - 1) * pageSize.value;
        pageItems.value = source.value.slice(start, start + pageSize.value);
    }

    function scheduleReslice(): Promise<void> {
        if (!queued) {
            queued = true;
            void nextTick(() => {
                queued = false;
                reslice();
            });
        }
        return nextTick();
    }

    function goToPage(next: number): void {
        page.value = Math.max(1, Math.min(next, pageCount.value));
        void scheduleReslice();
    }

    function setPageSize(next: number): void {
        if (next < 1 || next === pageSize.value) return;
        pageSize.value = next;
        visibleCount.value = Math.max(next, pageItems.value.length);
        goToPage(1);
    }

    async function loadMore(): Promise<void> {
        if (!hasMore.value) return;
        visibleCount.value = Math.min(
            visibleCount.value + pageSize.value,
            total.value
        );
        await scheduleReslice();
    }

    async function refresh(): Promise<void> {
        await scheduleReslice();
    }

    watch(source, () => {
        void scheduleReslice();
    });

    reslice();
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
