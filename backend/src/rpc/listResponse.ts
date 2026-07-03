/**
 * Standard list response envelope for JSON-RPC 2.0 collection endpoints.
 *
 * Follows:
 * - Google JSON Style Guide: `items` is the reserved field for collections
 * - Shelly device RPC convention: `total` + `offset` for pagination
 * - Fleet Manager extensions: `limit` (page size) + `has_more` (convenience)
 */

import RpcError from './RpcError';

export interface ListResponse<T = any> {
    items: T[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

/**
 * Build a standard list response envelope.
 */
export function buildListResponse<T>(
    items: T[],
    total: number,
    limit: number,
    offset: number
): ListResponse<T> {
    return {
        items,
        total,
        limit,
        offset,
        has_more: offset + items.length < total
    };
}

/**
 * Read the windowed total from rows selected with `COUNT(*) OVER() AS
 * total_count`. The count is identical on every row, so the first row carries
 * it; an empty page means zero matches.
 */
export function totalFromRows(
    rows: ReadonlyArray<{total_count?: number}>
): number {
    return rows[0]?.total_count ?? 0;
}

/**
 * Apply pagination to an array and return the standard envelope.
 * - limit 0 = unlimited (returns all items)
 * - No limit param = apply defaultLimit
 */
export function paginateAndBuild<T>(
    allItems: T[],
    params?: {limit?: number; offset?: number},
    defaultLimit = 0
): ListResponse<T> {
    const total = allItems.length;
    const rawLimit =
        typeof params?.limit === 'number' ? params.limit : defaultLimit;
    // Negative limit broke has_more; reject. Negative offset stays soft-0.
    if (rawLimit < 0) {
        throw RpcError.InvalidParams('limit must be >= 0');
    }
    const limit = rawLimit === 0 ? total : rawLimit;
    const offset =
        typeof params?.offset === 'number' && params.offset >= 0
            ? params.offset
            : 0;
    const sliced = allItems.slice(offset, offset + limit);
    return buildListResponse(sliced, total, rawLimit, offset);
}
