import type {Ref} from 'vue';
import type {
    FetchPage,
    FetchPageArgs,
    FetchPageResult
} from '@/composables/useListSource';

// Adapt a fully-fetched local list into the FetchPage contract. Same shape
// as the future cursor-based RPC, so swapping to server pagination is a
// per-page change with no template impact.
export function clientSliceFetcher<T>(source: Ref<readonly T[]>): FetchPage<T> {
    return ({cursor, pageSize}: FetchPageArgs) =>
        Promise.resolve(sliceAt(source.value, cursor, pageSize));
}

function sliceAt<T>(
    full: readonly T[],
    cursor: string | null,
    size: number
): FetchPageResult<T> {
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(full.length, start + size);
    return {
        items: full.slice(start, end),
        nextCursor: end < full.length ? String(end) : null,
        total: cursor === null ? full.length : undefined
    };
}
