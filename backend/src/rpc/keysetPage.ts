// Keyset paging for list RPCs. Offset pages keep the total; cursor pages
// skip the count and read one extra row to learn has_more. The cursor is the
// last row's sort key as base64url JSON: opaque to callers, checked per list,
// and never a grant (every page is filtered by the caller's scope again).
import {buildListResponse} from './listResponse';
import RpcError from './RpcError';

export type KeysetKey = Array<string | number | boolean>;

export interface KeysetPageParams {
    limit?: number;
    offset?: number;
    cursor?: string;
}

export interface KeysetPageRequest {
    limit: number;
    offset: number;
    after: KeysetKey | null;
    fetchLimit: number;
}

export interface KeysetListPage<Item> {
    items: Item[];
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
    total?: number;
    offset?: number;
}

export interface KeysetRow {
    total_count?: number | string | null;
    cursor_key?: unknown;
}

type KeyCheck = (key: unknown[]) => boolean;

const MICROSECOND_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMicrosecondTime(value: unknown): boolean {
    return typeof value === 'string' && MICROSECOND_TIME.test(value);
}

/** [time with microseconds, positive integer id], newest-first lists. */
export function isMicrosecondTimeIdKey(key: unknown[]): boolean {
    return (
        key.length === 2 &&
        isMicrosecondTime(key[0]) &&
        Number.isInteger(key[1]) &&
        (key[1] as number) > 0
    );
}

/** [time with microseconds, uuid id], newest-first lists. */
export function isMicrosecondTimeUuidKey(key: unknown[]): boolean {
    return (
        key.length === 2 &&
        isMicrosecondTime(key[0]) &&
        typeof key[1] === 'string' &&
        UUID.test(key[1])
    );
}

const MEMBERSHIP_KEY_TYPES = [
    'string',
    'boolean',
    'string',
    'boolean',
    'number',
    'boolean',
    'string',
    'boolean',
    'string'
] as const;

/** Membership order: subject type, then (is null, value) pairs for the
 *  projected subject id, device id, stored subject id and entity suffix. */
export function isMembershipKey(key: unknown[]): boolean {
    return (
        key.length === MEMBERSHIP_KEY_TYPES.length &&
        key.every((value, i) => typeof value === MEMBERSHIP_KEY_TYPES[i]) &&
        Number.isInteger(key[4])
    );
}

function invalidCursor(): RpcError {
    return RpcError.InvalidParams('cursor is not valid', [
        {
            field: 'cursor',
            error: 'not a cursor from this list',
            code: 'pattern'
        }
    ]);
}

function parseCursor(cursor: string): unknown {
    try {
        return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        throw invalidCursor();
    }
}

export function encodeKeysetCursor(key: KeysetKey): string {
    return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeKeysetCursor(cursor: string, isKey: KeyCheck): KeysetKey {
    const key = parseCursor(cursor);
    if (!Array.isArray(key) || !isKey(key)) throw invalidCursor();
    return key as KeysetKey;
}

export function keysetPageRequest(
    p: KeysetPageParams,
    options: {defaultLimit: number; isKey: KeyCheck}
): KeysetPageRequest {
    const limit = p.limit ?? options.defaultLimit;
    if (p.cursor === undefined) {
        return {limit, offset: p.offset ?? 0, after: null, fetchLimit: limit};
    }
    // Schemas fill offset 0; only a real offset conflicts with a cursor.
    if ((p.offset ?? 0) > 0) {
        throw RpcError.InvalidParams('send cursor or offset, not both', [
            {
                field: 'offset',
                error: 'not allowed with cursor',
                code: 'conflict'
            }
        ]);
    }
    return {
        limit,
        offset: 0,
        after: decodeKeysetCursor(p.cursor, options.isKey),
        fetchLimit: limit + 1
    };
}

function nextCursor<Row extends KeysetRow>(
    last: Row | undefined,
    hasMore: boolean
): string | null {
    if (!hasMore || !Array.isArray(last?.cursor_key)) return null;
    return encodeKeysetCursor(last.cursor_key as KeysetKey);
}

export function keysetListPage<Row extends KeysetRow, Item>(
    rows: Row[],
    options: {
        page: KeysetPageRequest;
        isRow: (row: Row) => boolean;
        /** null drops a stored row the list does not show. */
        toItem: (row: Row) => Item | null;
    }
): KeysetListPage<Item> {
    const {page} = options;
    const listed = rows.filter(options.isRow);
    const shown = listed.slice(0, page.limit);
    const total = Number(rows[0]?.total_count ?? 0);
    const hasMore =
        page.after === null
            ? page.offset + shown.length < total
            : listed.length > page.limit;
    const items = shown
        .map(options.toItem)
        .filter((item): item is Item => item !== null);
    const next_cursor = nextCursor(shown[shown.length - 1], hasMore);
    if (page.after !== null) {
        return {items, limit: page.limit, has_more: hasMore, next_cursor};
    }
    return {
        ...buildListResponse(items, total, page.limit, page.offset),
        next_cursor
    };
}
