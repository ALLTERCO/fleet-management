import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceBindingSourceRef,
    VirtualDeviceReplacementReportDto,
    VirtualDeviceReplacementReportItem,
    VirtualDeviceReplacementReportParams
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';

interface ReportDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

interface ReportRow {
    event_type: 'create' | 'replace' | 'retire';
    role_key: string | null;
    old_source_json: VirtualDeviceBindingSourceRef | null;
    new_source_json: VirtualDeviceBindingSourceRef | null;
    actor_id: string | null;
    reason: string | null;
    created_at: Date | string;
    total_count: number | string;
}

const defaultDeps: ReportDeps = {
    queryRows: postgres.queryRows
};

export async function readVirtualDeviceReplacementReport(
    organizationId: string,
    input: VirtualDeviceReplacementReportParams,
    deps: ReportDeps = defaultDeps
): Promise<VirtualDeviceReplacementReportDto> {
    const limit = input.limit ?? 200;
    const offset = input.offset ?? 0;
    const filter = reportFilter(organizationId, input);
    const rows = await deps.queryRows<ReportRow>(
        `SELECT
            e.event_type,
            COALESCE(
                e.new_source_json->>'roleKey',
                e.old_source_json->>'roleKey',
                b.role_key
            ) AS role_key,
            e.old_source_json,
            e.new_source_json,
            e.actor_id,
            e.reason,
            e.created_at,
            COUNT(*) OVER() AS total_count
           FROM device.virtual_device_binding_event e
           JOIN device.virtual_device vd
             ON vd.device_list_id = e.virtual_device_list_id
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
           LEFT JOIN device.virtual_device_binding b
             ON b.id = e.binding_id
          WHERE ${filter.where.join(' AND ')}
          ORDER BY e.created_at DESC
          LIMIT $${filter.values.length + 1}
         OFFSET $${filter.values.length + 2}`,
        [...filter.values, limit, offset]
    );
    if (rows.length === 0) {
        await assertVirtualDeviceExists(organizationId, input.externalId, deps);
        return buildListResponse([], 0, limit, offset);
    }
    return buildListResponse(
        rows.map(rowToReportItem),
        Number(rows[0]?.total_count ?? 0),
        limit,
        offset
    );
}

function reportFilter(
    organizationId: string,
    input: VirtualDeviceReplacementReportParams
): {where: string[]; values: unknown[]} {
    const values: unknown[] = [organizationId, input.externalId];
    const where = [
        'vd.organization_id = $1',
        'dl.external_id = $2',
        'vd.deleted_at IS NULL'
    ];
    if (input.roleKey) {
        values.push(input.roleKey);
        where.push(
            `(b.role_key = $${values.length} OR e.new_source_json->>'roleKey' = $${values.length} OR e.old_source_json->>'roleKey' = $${values.length})`
        );
    }
    addDateFilter(where, values, 'e.created_at >=', input.from);
    addDateFilter(where, values, 'e.created_at <=', input.to);
    return {where, values};
}

function addDateFilter(
    where: string[],
    values: unknown[],
    expression: string,
    value?: string
): void {
    if (!value) return;
    values.push(value);
    where.push(`${expression} $${values.length}::timestamptz`);
}

async function assertVirtualDeviceExists(
    organizationId: string,
    externalId: string,
    deps: ReportDeps
): Promise<void> {
    const rows = await deps.queryRows<{id: number}>(
        `SELECT vd.device_list_id AS id
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
          WHERE vd.organization_id = $1
            AND dl.external_id = $2
            AND vd.deleted_at IS NULL
          LIMIT 1`,
        [organizationId, externalId]
    );
    if (!rows[0]) throw RpcError.NotFound('virtual_device', externalId);
}

function rowToReportItem(row: ReportRow): VirtualDeviceReplacementReportItem {
    return {
        eventType: row.event_type,
        roleKey: row.role_key,
        oldSource: row.old_source_json,
        newSource: row.new_source_json,
        actorId: row.actor_id,
        reason: row.reason,
        createdAt: dateToIso(row.created_at)
    };
}

function dateToIso(value: Date | string): string {
    return value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
}
