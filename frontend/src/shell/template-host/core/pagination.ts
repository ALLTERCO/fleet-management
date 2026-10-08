// Cursor or offset pagination over an injected RPC caller, bounded so a backend that
// never stops paging fails instead of hanging the tab.

import {createFleetSdkError, FLEET_PAGINATION_NO_PROGRESS} from './errors';
import type {RpcCaller} from './rpc-client';
import type {HostPagedEnvelope} from './types';

export const DEFAULT_PAGE_SIZE = 1000;

// Ten million rows at the default page size: past any real list, soon enough
// that a looping backend fails in seconds.
export const MAX_PAGES = 10_000;

export type ListAll = <TItem = unknown>(
    namespace: string,
    methodPath: string | readonly string[],
    params?: object,
    pageSize?: number
) => Promise<TItem[]>;

/** A backend ignoring `offset` repeats its first row; null falls back to the
 * page cap. */
function pageSignature(items: readonly unknown[]): string | null {
    try {
        return `${items.length}:${JSON.stringify(items[0] ?? null)}`;
    } catch {
        return null;
    }
}

function noProgressError(method: string, offset: number) {
    return createFleetSdkError(
        FLEET_PAGINATION_NO_PROGRESS,
        `Pagination for ${method} stopped making progress at offset ${offset}`
    );
}

export type CursorPage<TItem> = {
    items: TItem[];
    has_more: boolean;
    next_cursor: string | null;
};

export type CursorPass<TItem> = {
    items: TItem[];
    /** False when the page cap stopped the pass before the last page. */
    complete: boolean;
};

function cursorNoProgressError(cursor: string | null) {
    return createFleetSdkError(
        FLEET_PAGINATION_NO_PROGRESS,
        `Cursor pagination stopped making progress at ${String(cursor)}`
    );
}

/** Keyset pages: the first fetch gets a null cursor, each next one the
 * cursor the previous page named. */
export async function paginateByCursor<TItem>(
    fetchPage: (cursor: string | null) => Promise<CursorPage<TItem>>,
    maxPages: number = MAX_PAGES
): Promise<CursorPass<TItem>> {
    const items: TItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
        const result: CursorPage<TItem> = await fetchPage(cursor);
        items.push(...(result.items ?? []));
        if (!result.has_more) return {items, complete: true};
        if (!result.next_cursor || result.next_cursor === cursor) {
            throw cursorNoProgressError(cursor);
        }
        cursor = result.next_cursor;
    }
    return {items, complete: false};
}

export function createListAll(call: RpcCaller): ListAll {
    return async function listAll<TItem = unknown>(
        namespace: string,
        methodPath: string | readonly string[],
        params: object = {},
        pageSize: number = DEFAULT_PAGE_SIZE
    ): Promise<TItem[]> {
        // Our own paging keys win; offset and cursor never go out together.
        const {
            offset: _offset,
            cursor: _cursor,
            ...base
        } = params as Record<string, unknown>;
        const all: TItem[] = [];
        let offset = 0;
        let cursor: string | null = null;
        let previousSignature: string | null = null;

        for (let page = 0; page < MAX_PAGES; page++) {
            const paging: Record<string, unknown> =
                cursor !== null ? {cursor} : page > 0 ? {offset} : {};
            const envelope = await call<HostPagedEnvelope<TItem>>(
                namespace,
                methodPath,
                {...base, limit: pageSize, ...paging}
            );
            const items = envelope.items ?? [];
            all.push(...items);

            if (envelope.next_cursor !== undefined) {
                if (!envelope.has_more) return all;
                if (!envelope.next_cursor || envelope.next_cursor === cursor) {
                    throw cursorNoProgressError(cursor);
                }
                cursor = envelope.next_cursor;
                continue;
            }

            const signature = pageSignature(items);
            if (
                page > 0 &&
                signature !== null &&
                signature === previousSignature
            ) {
                throw noProgressError(String(methodPath), offset);
            }
            previousSignature = signature;
            if (!envelope.has_more || items.length < pageSize) return all;
            offset += pageSize;
        }

        throw noProgressError(String(methodPath), offset);
    };
}
