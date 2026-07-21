// Pagination loop for ListResponse envelopes — {items, has_more}.

export interface PagedEnvelope<T> {
    items: T[];
    has_more: boolean;
}

// Backend list param schemas cap limit at 500 (e.g. CREDENTIAL_LIST_PARAMS_SCHEMA).
export const BACKEND_LIST_MAX_LIMIT = 500;

export async function paginate<T>(
    fetchPage: (offset: number) => Promise<PagedEnvelope<T>>,
    pageSize: number
): Promise<T[]> {
    const all: T[] = [];
    let offset = 0;
    while (true) {
        const res = await fetchPage(offset);
        const items = res?.items ?? [];
        all.push(...items);
        if (!res?.has_more || items.length < pageSize) break;
        offset += pageSize;
    }
    return all;
}

// For endpoints whose envelope lies (total = page rows, has_more always
// false): keep fetching while pages come back full, ignore has_more.
export async function paginateWhileFull<T>(
    fetchPage: (offset: number) => Promise<{items: T[]}>,
    pageSize: number
): Promise<T[]> {
    const all: T[] = [];
    let offset = 0;
    while (true) {
        const res = await fetchPage(offset);
        const items = res?.items ?? [];
        all.push(...items);
        if (items.length !== pageSize) break;
        offset += pageSize;
    }
    return all;
}
