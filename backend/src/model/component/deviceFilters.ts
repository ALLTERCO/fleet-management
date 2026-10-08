// Refusing a filter the list cannot answer.
//
// The rule itself moved to `types/api/deviceFilters` so the frontend shares
// it. What stays here is the part that throws, which is backend-only.

import RpcError from '../../rpc/RpcError';
import {DEVICE_FILTER_KEYS} from '../../types/api/deviceFilters';

export * from '../../types/api/deviceFilters';

const KNOWN: ReadonlySet<string> = new Set(DEVICE_FILTER_KEYS);

/** The keys that need the membership tables read before filtering. */
const MEMBERSHIP_KEYS: ReadonlySet<string> = new Set([
    'locationId',
    'groupId',
    'tagId'
]);

/** True when any supplied filter needs group/location/tag membership. */
export function filtersNeedMemberships(
    filters: Record<string, unknown> | undefined
): boolean {
    if (!filters) return false;
    return Object.keys(filters).some((key) => MEMBERSHIP_KEYS.has(key));
}

/** Kinds live on the org tables too, so they are read only when asked for. */
export function filtersNeedKinds(
    filters: Record<string, unknown> | undefined
): boolean {
    return !!filters && 'kind' in filters;
}

/**
 * Refuses a filter the list cannot answer.
 *
 * Loud, because the alternative is what shipped: an unknown key quietly
 * matched nothing and the caller saw an empty fleet. A wrong answer that looks
 * like a real one is worse than an error.
 */
export function assertKnownDeviceFilters(
    filters: Record<string, unknown> | undefined
): void {
    if (!filters) return;
    const unknown = Object.keys(filters).filter((key) => !KNOWN.has(key));
    if (unknown.length === 0) return;
    throw RpcError.Domain('ValidationFailed', {
        message: `unknown device filter: ${unknown.join(', ')}. Supported: ${DEVICE_FILTER_KEYS.join(', ')}`,
        field: 'filters',
        details: {unknown, supported: [...DEVICE_FILTER_KEYS]}
    });
}
