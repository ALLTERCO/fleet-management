// One page of the entity list, walked owner by owner.
//
// The list is physical, then virtual, then BLU entities. Inside a segment the
// order is owner shellyID, then entity id. A cursor names the last entity
// served, so a cursor page reads only the owners it reaches and never counts
// the whole fleet; an offset page still needs the total, so it counts owners
// (owner counts only; it loads the entities of the owners on the page).

import RpcError from '../../rpc/RpcError';
import type {entity_t} from '../../types';

export type EntityListItem = entity_t & {source: string; online: boolean};

export interface EntityOwner {
    /** The device the entities belong to; the order key inside a segment. */
    owner: string;
    count: number;
}

/** Owners are read only when the walk reaches the segment. */
export interface EntityListSegment {
    owners(): Promise<readonly EntityOwner[]>;
    load(owners: readonly string[]): Promise<EntityListItem[]>;
}

export interface EntityListPageRequest {
    limit?: number;
    offset?: number;
    cursor?: string;
}

export interface EntityListPage {
    items: EntityListItem[];
    /** Present on offset pages only. */
    total?: number;
    limit: number;
    /** Present on offset pages only. */
    offset?: number;
    has_more: boolean;
    nextCursor: string | null;
}

interface EntityListPosition {
    segment: number;
    owner: string;
    entity: string;
}

interface PlacedItem {
    segment: number;
    item: EntityListItem;
}

function compareText(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

function compareItems(a: EntityListItem, b: EntityListItem): number {
    return compareText(a.source, b.source) || compareText(a.id, b.id);
}

function encodeEntityListCursor(position: EntityListPosition): string {
    return Buffer.from(
        JSON.stringify([position.segment, position.owner, position.entity])
    ).toString('base64url');
}

function invalidPaging(field: string, error: string): RpcError {
    return RpcError.InvalidParams(`${field} is not valid`, [
        {field, error, code: 'pattern'}
    ]);
}

function parseCursorText(cursor: string): unknown {
    try {
        return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        throw invalidPaging('cursor', 'not a cursor from this list');
    }
}

function decodeEntityListCursor(cursor: string): EntityListPosition {
    const value = parseCursorText(cursor);
    if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        !Number.isInteger(value[0]) ||
        value[0] < 0 ||
        typeof value[1] !== 'string' ||
        typeof value[2] !== 'string'
    ) {
        throw invalidPaging('cursor', 'not a cursor from this list');
    }
    return {segment: value[0], owner: value[1], entity: value[2]};
}

function servedLimit(
    request: EntityListPageRequest,
    bounds: {defaultLimit: number; maxLimit: number}
): number {
    const requested = request.limit ?? bounds.defaultLimit;
    if (requested === 0) return request.cursor ? bounds.maxLimit : 0;
    return Math.min(requested, bounds.maxLimit);
}

/** Owners from `start` whose expected entities cover `wanted` more rows. */
function ownersCovering(
    owners: readonly EntityOwner[],
    start: number,
    wanted: number
): readonly EntityOwner[] {
    let covered = 0;
    let end = start;
    while (end < owners.length && covered < wanted) {
        covered += owners[end].count;
        end += 1;
    }
    return owners.slice(start, end);
}

async function loadSorted(
    segment: EntityListSegment,
    owners: readonly EntityOwner[]
): Promise<EntityListItem[]> {
    if (owners.length === 0) return [];
    const items = await segment.load(owners.map((owner) => owner.owner));
    return items.sort(compareItems);
}

function firstOwnerAtOrAfter(
    owners: readonly EntityOwner[],
    owner: string
): number {
    const index = owners.findIndex(
        (candidate) => compareText(candidate.owner, owner) >= 0
    );
    return index === -1 ? owners.length : index;
}

function isAfter(item: EntityListItem, position: EntityListPosition): boolean {
    return (
        compareText(item.source, position.owner) > 0 ||
        (item.source === position.owner &&
            compareText(item.id, position.entity) > 0)
    );
}

async function collectAfterCursor(
    segments: readonly EntityListSegment[],
    after: EntityListPosition,
    wanted: number
): Promise<PlacedItem[]> {
    const placed: PlacedItem[] = [];
    for (let index = after.segment; index < segments.length; index++) {
        const owners = await segments[index].owners();
        let next =
            index === after.segment
                ? firstOwnerAtOrAfter(owners, after.owner)
                : 0;
        while (next < owners.length && placed.length < wanted) {
            const batch = ownersCovering(owners, next, wanted - placed.length);
            next += batch.length;
            for (const item of await loadSorted(segments[index], batch)) {
                if (index === after.segment && !isAfter(item, after)) continue;
                placed.push({segment: index, item});
            }
        }
        if (placed.length >= wanted) return placed;
    }
    return placed;
}

async function cursorPage(
    segments: readonly EntityListSegment[],
    request: {cursor: string; limit: number}
): Promise<EntityListPage> {
    const after = decodeEntityListCursor(request.cursor);
    // One row past the page answers has_more without counting the fleet.
    const placed = await collectAfterCursor(segments, after, request.limit + 1);
    const page = placed.slice(0, request.limit);
    const last = page.at(-1);
    const hasMore = placed.length > request.limit;
    return {
        items: page.map((entry) => entry.item),
        limit: request.limit,
        has_more: hasMore,
        nextCursor:
            hasMore && last
                ? encodeEntityListCursor({
                      segment: last.segment,
                      owner: last.item.source,
                      entity: last.item.id
                  })
                : null
    };
}

/** The owners overlapping [offset, end) in one segment, and where they start. */
function ownersInWindow(
    owners: readonly EntityOwner[],
    window: {segmentStart: number; offset: number; end: number}
): {owners: EntityOwner[]; firstIndex: number} {
    const selected: EntityOwner[] = [];
    let position = window.segmentStart;
    let firstIndex = -1;
    for (const owner of owners) {
        const ownerEnd = position + owner.count;
        if (ownerEnd > window.offset && position < window.end) {
            if (firstIndex === -1) firstIndex = position;
            selected.push(owner);
        }
        position = ownerEnd;
    }
    return {owners: selected, firstIndex};
}

async function offsetPage(
    segments: readonly EntityListSegment[],
    request: {offset: number; limit: number}
): Promise<EntityListPage> {
    const ownersBySegment = await Promise.all(
        segments.map((segment) => segment.owners())
    );
    const total = ownersBySegment
        .flat()
        .reduce((sum, owner) => sum + owner.count, 0);
    const end = request.limit === 0 ? total : request.offset + request.limit;
    const placed: PlacedItem[] = [];
    let segmentStart = 0;
    for (const [index, owners] of ownersBySegment.entries()) {
        const window = ownersInWindow(owners, {
            segmentStart,
            offset: request.offset,
            end
        });
        const items = await loadSorted(segments[index], window.owners);
        items.forEach((item, at) => {
            const position = window.firstIndex + at;
            if (position >= request.offset && position < end) {
                placed.push({segment: index, item});
            }
        });
        segmentStart += owners.reduce((sum, owner) => sum + owner.count, 0);
    }
    const last = placed.at(-1);
    const hasMore = request.offset + placed.length < total;
    return {
        items: placed.map((entry) => entry.item),
        total,
        limit: request.limit,
        offset: request.offset,
        has_more: hasMore,
        nextCursor:
            hasMore && last
                ? encodeEntityListCursor({
                      segment: last.segment,
                      owner: last.item.source,
                      entity: last.item.id
                  })
                : null
    };
}

/**
 * One page of the entity list, by cursor or by offset.
 *
 * Without a cursor this is the documented offset page, total included. Every
 * page carries `nextCursor`, so a caller pays the count once and walks on by
 * cursor. limit 0 keeps its every-row meaning only on an offset page.
 */
export async function pageEntityList(
    segments: readonly EntityListSegment[],
    input: {
        request: EntityListPageRequest;
        bounds: {defaultLimit: number; maxLimit: number};
    }
): Promise<EntityListPage> {
    const {request, bounds} = input;
    if (request.cursor !== undefined && request.offset !== undefined) {
        throw invalidPaging('offset', 'not with cursor');
    }
    const limit = servedLimit(request, bounds);
    if (request.cursor === undefined) {
        return offsetPage(segments, {
            offset: Math.max(request.offset ?? 0, 0),
            limit
        });
    }
    return cursorPage(segments, {cursor: request.cursor, limit});
}
