import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceHistoryBackfillDto,
    VirtualDeviceHistoryBackfillParams
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';

interface BackfillDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

interface BackfillRow {
    inserted_rows: number | string;
    provenance_rows: number | string;
    scanned_rows: number | string;
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
    const rows = await deps.queryRows<BackfillRow>(
        `WITH target AS (
            SELECT vd.device_list_id
              FROM device.virtual_device vd
              JOIN device.list dl
                ON dl.id = vd.device_list_id
               AND dl.organization_id = vd.organization_id
             WHERE vd.organization_id = $1
               AND dl.external_id = $2
               AND vd.deleted_at IS NULL
             LIMIT 1
        ),
        segments AS (
            SELECT
                b.id AS binding_id,
                b.virtual_device_list_id,
                b.source_device_list_id,
                src.external_id AS source_external_id,
                b.source_component_key,
                GREATEST(b.effective_from, $5::timestamptz) AS segment_from,
                LEAST(COALESCE(b.effective_to, $6::timestamptz), $6::timestamptz) AS segment_to
              FROM device.virtual_device_binding b
              JOIN target t ON t.device_list_id = b.virtual_device_list_id
              JOIN device.list src
                ON src.id = b.source_device_list_id
               AND src.organization_id = b.organization_id
             WHERE b.organization_id = $1
               AND b.role_key = $3
               AND b.mode IN ('linked', 'materialized')
               AND b.effective_from < $6::timestamptz
               AND COALESCE(b.effective_to, 'infinity'::timestamptz) > $5::timestamptz
        ),
        source_rows AS (
            SELECT
                s.binding_id,
                s.virtual_device_list_id,
                s.source_device_list_id,
                s.source_external_id,
                s.source_component_key,
                tl.ts,
                tl.value,
                tl.prev_value
              FROM segments s
              CROSS JOIN LATERAL device.fn_status_timeline(
                ARRAY[s.source_device_list_id],
                s.source_component_key || '.' || $4,
                s.segment_from,
                s.segment_to
              ) tl
             ORDER BY tl.ts ASC
             LIMIT $7
        ),
        inserted_status AS (
            INSERT INTO device.status (
                id,
                ts,
                field,
                field_group,
                value,
                prev_value
            )
            SELECT
                source_rows.virtual_device_list_id,
                source_rows.ts,
                $3 || '.' || $4,
                $3,
                source_rows.value,
                source_rows.prev_value
              FROM source_rows
             WHERE NOT EXISTS (
                SELECT 1
                  FROM device.status existing
                 WHERE existing.id = source_rows.virtual_device_list_id
                   AND existing.ts = source_rows.ts
                   AND existing.field = $3 || '.' || $4
             )
            RETURNING 1
        ),
        inserted_sources AS (
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
                source_rows.ts,
                $1,
                source_rows.virtual_device_list_id,
                source_rows.binding_id,
                $3,
                source_rows.source_device_list_id,
                source_rows.source_external_id,
                source_rows.source_component_key,
                source_rows.ts
              FROM source_rows
             WHERE NOT EXISTS (
                SELECT 1
                  FROM device.virtual_device_sample_source existing
                 WHERE existing.virtual_device_list_id = source_rows.virtual_device_list_id
                   AND existing.role_key = $3
                   AND existing.ts = source_rows.ts
                   AND existing.binding_id = source_rows.binding_id
             )
            RETURNING 1
        )
        SELECT
            (SELECT COUNT(*) FROM inserted_status) AS inserted_rows,
            (SELECT COUNT(*) FROM inserted_sources) AS provenance_rows,
            (SELECT COUNT(*) FROM source_rows) AS scanned_rows`,
        [
            organizationId,
            input.externalId,
            input.roleKey,
            input.field,
            input.from,
            input.to,
            input.limit ?? DEFAULT_BACKFILL_LIMIT
        ]
    );
    return {
        externalId: input.externalId,
        roleKey: input.roleKey,
        field: input.field,
        insertedRows: Number(rows[0]?.inserted_rows ?? 0),
        scannedRows: Number(rows[0]?.scanned_rows ?? 0)
    };
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
