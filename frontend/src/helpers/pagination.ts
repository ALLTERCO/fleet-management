// Pagination loop for ListResponse envelopes — {items, has_more}.

export interface PagedEnvelope<T> {
    items: T[];
    has_more: boolean;
}

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
