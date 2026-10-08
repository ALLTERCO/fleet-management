// Pure helpers; kept config-free so tests skip the config barrel.

import RpcError from '../../rpc/RpcError';
import type AbstractDevice from '../AbstractDevice';
import {
    type DeviceFilterMemberships,
    type DeviceFilterView,
    deviceMatchesFilters,
    NO_FILTER_MEMBERSHIPS
} from './deviceFilters';

export function isNonEmptyFilters(
    filters: Record<string, any> | undefined
): filters is Record<string, any> {
    return (
        !!filters &&
        typeof filters === 'object' &&
        Object.keys(filters).length > 0
    );
}

/**
 * Physical devices, filtered through the shared rule.
 *
 * `memberships` is supplied only when a membership filter was asked for, so an
 * ordinary list still costs no extra query.
 */
export function applyFilters(
    devices: readonly AbstractDevice[],
    filters: Record<string, any>,
    memberships?: ReadonlyMap<string, DeviceFilterMemberships>,
    kinds?: ReadonlyMap<string, string | null>
): AbstractDevice[] {
    return devices.filter((device) =>
        deviceMatchesFilters(
            physicalFilterView(
                device,
                memberships?.get(device.shellyID) ?? NO_FILTER_MEMBERSHIPS,
                kinds?.get(device.shellyID) ?? null
            ),
            filters
        )
    );
}

/** One builder for the physical view, so topology asks the list's question. */
export function physicalFilterView(
    device: AbstractDevice,
    memberships: DeviceFilterMemberships,
    kind: string | null = null
): DeviceFilterView {
    const profile = device.profile;
    return {
        shellyID: device.shellyID,
        id: device.id,
        source: device.source ?? 'offline',
        presence: device.presence,
        model: device.info?.model ?? null,
        kind,
        battery: profile?.flags.isBattery ?? null,
        componentTypes: profile ? [...profile.componentTypes] : [],
        ...memberships
    };
}

/** Where a row sits in the one device-list order: device row id, then id. */
export interface DeviceListPosition {
    id: number;
    shellyID: string;
}

export interface DeviceListPageRequest {
    limit?: number;
    offset?: number;
    cursor?: string;
}

export interface DeviceListPageResult<T> {
    items: T[];
    /** The page size served; 0 only for the legacy every-row offset page. */
    limit: number;
    offset: number;
    nextCursor: string | null;
}

function compareDeviceListPositions(
    a: DeviceListPosition,
    b: DeviceListPosition
): number {
    if (a.id !== b.id) return a.id - b.id;
    if (a.shellyID === b.shellyID) return 0;
    return a.shellyID < b.shellyID ? -1 : 1;
}

/** New rows get a higher row id, so they land after every page already read. */
export function orderDeviceList<T>(
    items: readonly T[],
    positionOf: (item: T) => DeviceListPosition
): T[] {
    return [...items].sort((a, b) =>
        compareDeviceListPositions(positionOf(a), positionOf(b))
    );
}

export function encodeDeviceListCursor(position: DeviceListPosition): string {
    return Buffer.from(`${position.id}|${position.shellyID}`).toString(
        'base64url'
    );
}

export function decodeDeviceListCursor(cursor: string): DeviceListPosition {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = text.indexOf('|');
    const id = Number(text.slice(0, separator));
    const shellyID = text.slice(separator + 1);
    if (separator < 1 || !Number.isSafeInteger(id) || shellyID.length === 0) {
        throw invalidPaging('cursor', 'not a cursor from this list');
    }
    return {id, shellyID};
}

function invalidPaging(field: string, error: string): RpcError {
    return RpcError.InvalidParams(`${field} is not valid`, [
        {field, error, code: 'pattern'}
    ]);
}

/** First index whose position comes after `after` in an ordered list. */
function indexAfter<T>(
    ordered: readonly T[],
    positionOf: (item: T) => DeviceListPosition,
    after: DeviceListPosition
): number {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (compareDeviceListPositions(positionOf(ordered[middle]), after) <= 0)
            low = middle + 1;
        else high = middle;
    }
    return low;
}

function servedLimit(
    request: DeviceListPageRequest,
    bounds: {defaultLimit: number; maxLimit: number}
): number {
    const requested = request.limit ?? bounds.defaultLimit;
    if (requested === 0) return request.cursor ? bounds.maxLimit : 0;
    return Math.min(requested, bounds.maxLimit);
}

/**
 * One page of an ordered device list, by cursor or by offset.
 *
 * A cursor names the last row read, so rows added or removed before it never
 * shift the next page. limit 0 keeps its documented every-row meaning only on
 * an offset page.
 */
export function pageDeviceList<T>(
    ordered: readonly T[],
    input: {
        positionOf: (item: T) => DeviceListPosition;
        request: DeviceListPageRequest;
        bounds: {defaultLimit: number; maxLimit: number};
    }
): DeviceListPageResult<T> {
    const {positionOf, request, bounds} = input;
    if (request.cursor !== undefined && request.offset !== undefined) {
        throw invalidPaging('offset', 'not with cursor');
    }
    const limit = servedLimit(request, bounds);
    const start =
        request.cursor === undefined
            ? Math.max(request.offset ?? 0, 0)
            : indexAfter(
                  ordered,
                  positionOf,
                  decodeDeviceListCursor(request.cursor)
              );
    const items = ordered.slice(
        start,
        limit === 0 ? ordered.length : start + limit
    );
    const last = items.at(-1);
    const nextCursor =
        last !== undefined && start + items.length < ordered.length
            ? encodeDeviceListCursor(positionOf(last))
            : null;
    return {items, limit, offset: start, nextCursor};
}

export function parseIncludeSet(include: unknown): Set<string> | undefined {
    if (!Array.isArray(include) || include.length === 0) return undefined;
    return new Set(include.filter((d): d is string => typeof d === 'string'));
}
