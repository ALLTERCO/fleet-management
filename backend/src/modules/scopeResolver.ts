/** Single SQL boundary for device.fn_resolve_scope. Every scope→devices lookup goes through here. */

import {callMethod} from './PostgresProvider';

export async function resolveScopeShellyIDs(
    orgId: string,
    scopeKind: 'group' | 'location' | 'tag' | 'fleet',
    scopeId: number | null
): Promise<string[]> {
    const {rows} = await callMethod('device.fn_resolve_scope', {
        p_org_id: orgId,
        p_scope_kind: scopeKind,
        p_scope_id: scopeId
    });
    const list = (rows ?? []) as Array<{shelly_id?: string | null}>;
    return list
        .map((r) => r.shelly_id)
        .filter((s): s is string => typeof s === 'string');
}

export async function resolveLocationShellyIDs(
    orgId: string,
    locationIds: readonly number[]
): Promise<Map<number, string[]>> {
    const byLocation = new Map<number, string[]>();
    if (locationIds.length === 0) return byLocation;
    const {rows} = await callMethod('device.fn_resolve_scope_locations', {
        p_org_id: orgId,
        p_location_ids: [...locationIds]
    });
    const list = (rows ?? []) as Array<{
        scope_id?: number | null;
        shelly_id?: string | null;
    }>;
    for (const r of list) {
        if (typeof r.scope_id !== 'number') continue;
        if (typeof r.shelly_id !== 'string') continue;
        const bucket = byLocation.get(r.scope_id) ?? [];
        bucket.push(r.shelly_id);
        byLocation.set(r.scope_id, bucket);
    }
    return byLocation;
}
