import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceHistoryBackfillDto,
    VirtualDeviceHistoryBackfillParams
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';
import {
    type HistoryRepositoryDeps,
    readVirtualDeviceRoleSourceHistoryPage,
    type VirtualDeviceSourceHistoryPoint
} from './historyRepository';

interface BackfillDeps extends HistoryRepositoryDeps {}

interface BackfillRow {
    inserted_rows: number | string;
}

const DEFAULT_BACKFILL_LIMIT = 100_000;
const FIELD_PATTERN = /^[a-zA-Z][\w:.-]*$/;

const defaultDeps: BackfillDeps = {
    queryRows: postgres.queryRows
};

export async function backfillVirtualDeviceHistory(
    organizationId: string,
    input: VirtualDeviceHistoryBackfillParams,
    deps: BackfillDeps = defaultDeps
): Promise<VirtualDeviceHistoryBackfillDto> {
    assertBackfillField(input.field);
    assertBackfillWindow(input.from, input.to);
    const limit = input.limit ?? DEFAULT_BACKFILL_LIMIT;
    const offset = input.cursor ?? 0;
    const page = await readVirtualDeviceRoleSourceHistoryPage(
        organizationId,
        {
            externalId: input.externalId,
            roleKey: input.roleKey,
            from: input.from,
            to: input.to
        },
        {offset, limit, expectedField: input.field},
        deps
    );
    const insertedRows = await writeProjectedPage(
        organizationId,
        page.items,
        deps
    );
    return {
        externalId: input.externalId,
        roleKey: input.roleKey,
        field: input.field,
        insertedRows,
        scannedRows: page.items.length,
        hasMore: page.hasMore,
        nextCursor: page.hasMore ? offset + page.items.length : null
    };
}

async function writeProjectedPage(
    organizationId: string,
    items: readonly VirtualDeviceSourceHistoryPoint[],
    deps: BackfillDeps
): Promise<number> {
    if (items.length === 0) return 0;
    const payload = items.map((point) => ({
        ts: point.ts,
        virtualDeviceListId: point.virtualDeviceListId,
        bindingId: point.bindingId,
        roleKey: point.roleKey,
        series: point.series,
        field: point.field,
        value: point.value,
        prevValue: point.prevValue,
        sourceDeviceListId: point.sourceDeviceListId,
        sourceExternalId: point.source.deviceExternalId,
        sourceComponentKey: point.source.componentKey,
        sourceTs: point.ts
    }));
    const rows = await deps.queryRows<BackfillRow>(
        `WITH source_rows AS (
            SELECT *
              FROM jsonb_to_recordset($2::jsonb) AS row(
                ts timestamptz,
                "virtualDeviceListId" integer,
                "bindingId" uuid,
                "roleKey" varchar,
                series varchar,
                field varchar,
                value jsonb,
                "prevValue" jsonb,
                "sourceDeviceListId" integer,
                "sourceExternalId" varchar,
                "sourceComponentKey" varchar,
                "sourceTs" timestamptz
              )
        ), inserted_projection AS (
            INSERT INTO device.virtual_device_projected_sample (
                ts,
                organization_id,
                virtual_device_list_id,
                binding_id,
                role_key,
                series,
                field,
                value,
                prev_value,
                source_device_list_id,
                source_external_id,
                source_component_key,
                source_ts
            )
            SELECT
                row.ts,
                $1,
                row."virtualDeviceListId",
                row."bindingId",
                row."roleKey",
                row.series,
                row.field,
                row.value,
                row."prevValue",
                row."sourceDeviceListId",
                row."sourceExternalId",
                row."sourceComponentKey",
                row."sourceTs"
              FROM source_rows row
            ON CONFLICT ON CONSTRAINT virtual_device_projected_sample_idempotency
                DO NOTHING
            RETURNING 1
        ), inserted_sources AS (
            INSERT INTO device.virtual_device_sample_source (
                ts,
                organization_id,
                virtual_device_list_id,
                binding_id,
                role_key,
                source_device_list_id,
                source_external_id,
                source_component_key,
                source_ts
            )
            SELECT
                row.ts,
                $1,
                row."virtualDeviceListId",
                row."bindingId",
                row."roleKey",
                row."sourceDeviceListId",
                row."sourceExternalId",
                row."sourceComponentKey",
                row."sourceTs"
              FROM source_rows row
            ON CONFLICT DO NOTHING
            RETURNING 1
        )
        SELECT COUNT(*) AS inserted_rows FROM inserted_projection`,
        [organizationId, JSON.stringify(payload)]
    );
    return Number(rows[0]?.inserted_rows ?? 0);
}

function assertBackfillField(field: string): void {
    if (FIELD_PATTERN.test(field)) return;
    throw RpcError.InvalidParams('invalid backfill field', [
        {field: 'field', error: field, code: 'invalid_field'}
    ]);
}

function assertBackfillWindow(from: string, to: string): void {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (
        !Number.isNaN(fromDate.getTime()) &&
        !Number.isNaN(toDate.getTime()) &&
        fromDate.getTime() < toDate.getTime()
    ) {
        return;
    }
    throw RpcError.InvalidParams('invalid backfill window', [
        {field: 'from', error: from, code: 'invalid_range'},
        {field: 'to', error: to, code: 'invalid_range'}
    ]);
}
