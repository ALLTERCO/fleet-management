// Read side of the device change journal. Mirrors AuditLogger.query — a thin
// typed wrapper over the device.fn_event_log_query SQL function.

import * as PostgresProvider from '../PostgresProvider';

export interface DeviceEventRow {
    ts: Date;
    received_ts: Date;
    shelly_id: string;
    organization_id: string | null;
    component: string;
    field: string;
    prev: unknown;
    next: unknown;
    kind: string;
    source: string | null;
}

export interface DeviceEventQuery {
    /** null only for a platform-admin all-tenant query. */
    organizationId: string | null;
    from?: Date;
    to?: Date;
    shellyIds?: string[];
    component?: string;
    kind?: string;
    limit?: number;
    offset?: number;
}

export async function queryDeviceEvents(
    query: DeviceEventQuery
): Promise<DeviceEventRow[]> {
    const result = await PostgresProvider.callMethod(
        'device.fn_event_log_query',
        {
            p_organization_id: query.organizationId,
            p_from: query.from?.toISOString() ?? null,
            p_to: query.to?.toISOString() ?? null,
            p_shelly_ids:
                query.shellyIds && query.shellyIds.length > 0
                    ? query.shellyIds
                    : null,
            p_component: query.component ?? null,
            p_kind: query.kind ?? null,
            p_limit: query.limit ?? 200,
            p_offset: query.offset ?? 0
        }
    );
    return (result?.rows ?? []) as DeviceEventRow[];
}
