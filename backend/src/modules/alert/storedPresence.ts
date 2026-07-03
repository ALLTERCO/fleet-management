import * as PostgresProvider from '../PostgresProvider';

export interface StoredPresenceRow {
    external_id: string;
    last_seen: Date | string | null;
    name?: string | null;
}

export async function storedDevicePresence(
    organizationId: string
): Promise<StoredPresenceRow[]> {
    return PostgresProvider.queryRows<StoredPresenceRow>(
        `SELECT external_id,
                last_seen,
                COALESCE(jdoc->'info'->>'name', jdoc->>'name') AS name
           FROM device.list
          WHERE organization_id = $1
            AND external_id IS NOT NULL`,
        [organizationId]
    );
}

export function timestampMs(
    value: Date | string | number | null | undefined
): number | null {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}
