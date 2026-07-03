// Repository for device.list.catalog_kind. device.list.kind is the structural
// construction type and must not store catalog classifications.

import * as postgres from '../PostgresProvider';

export interface DeviceKindRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

const defaultDeps: DeviceKindRepositoryDeps = {
    queryRows: postgres.queryRows
};

// organizationId scopes the lookup to the caller's org — defense in depth even
// though external_id is now globally unique.
export async function getDeviceKind(
    shellyID: string,
    organizationId: string | null = null,
    deps: DeviceKindRepositoryDeps = defaultDeps
): Promise<string | null> {
    const rows = await deps.queryRows<{kind: string | null}>(
        `SELECT catalog_kind AS kind FROM device.list
          WHERE external_id = $1${organizationId ? ' AND organization_id = $2' : ''}`,
        organizationId ? [shellyID, organizationId] : [shellyID]
    );
    return rows[0]?.kind ?? null;
}

// The device's billing label (device.list.cost_center), or null.
export async function getDeviceCostCenter(
    shellyID: string,
    organizationId: string | null = null,
    deps: DeviceKindRepositoryDeps = defaultDeps
): Promise<string | null> {
    const rows = await deps.queryRows<{cost_center: string | null}>(
        `SELECT cost_center FROM device.list
          WHERE external_id = $1${organizationId ? ' AND organization_id = $2' : ''}`,
        organizationId ? [shellyID, organizationId] : [shellyID]
    );
    return rows[0]?.cost_center ?? null;
}

// Returns true when a device row was updated; false means the shellyID is
// unknown (the caller maps that to NotFound). costCenter undefined leaves the
// column untouched; null clears it.
export async function setDeviceKind(
    params: {
        shellyID: string;
        kind: string | null;
        costCenter?: string | null;
        organizationId?: string | null;
    },
    deps: DeviceKindRepositoryDeps = defaultDeps
): Promise<boolean> {
    const sets = ['catalog_kind = $2', 'updated = CURRENT_TIMESTAMP'];
    const args: unknown[] = [params.shellyID, params.kind];
    if (params.costCenter !== undefined) {
        args.push(params.costCenter);
        sets.push(`cost_center = $${args.length}`);
    }
    const where = ['external_id = $1'];
    if (params.organizationId) {
        args.push(params.organizationId);
        where.push(`organization_id = $${args.length}`);
    }
    const rows = await deps.queryRows<{external_id: string}>(
        `UPDATE device.list SET ${sets.join(', ')}
         WHERE ${where.join(' AND ')}
         RETURNING external_id`,
        args
    );
    return rows.length > 0;
}

// Batch lookup for device.list — shellyID -> catalog kind. organizationId
// scopes it (defense in depth; external_id is globally unique).
export async function listDeviceKinds(
    shellyIDs: readonly string[],
    organizationId: string | null = null,
    deps: DeviceKindRepositoryDeps = defaultDeps
): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (shellyIDs.length === 0) return out;
    const args: unknown[] = [shellyIDs];
    let scope = '';
    if (organizationId) {
        args.push(organizationId);
        scope = ` AND organization_id = $${args.length}`;
    }
    const rows = await deps.queryRows<{external_id: string; kind: string}>(
        `SELECT external_id, catalog_kind AS kind FROM device.list
         WHERE external_id = ANY($1::varchar[]) AND catalog_kind IS NOT NULL${scope}`,
        args
    );
    for (const r of rows) out.set(r.external_id, r.kind);
    return out;
}
