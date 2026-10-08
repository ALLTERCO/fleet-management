import * as Observability from '../Observability';
import * as postgres from '../PostgresProvider';
import {jsonbParam} from '../postgresJsonb';
import type {BluetoothTelemetryArbiterPort} from '../redis/ports';
import type {StatusBatch, StatusSourceDevice} from '../status/batchCoalescer';
import type {BluetoothStatusRoute} from './bluetoothRepository';
import {
    type BluetoothGatewayIdentity,
    type BluetoothTelemetryRouterDeps,
    routeBluetoothTelemetry,
    telemetryTargetKey
} from './bluetoothTelemetryRouter';

export interface BluetoothProvenanceDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    acceptTelemetrySources?: BluetoothTelemetryArbiterPort['acceptMany'];
    loadRoutes?: BluetoothTelemetryRouterDeps['loadRoutes'];
}

export interface BluetoothStatusBatchEntry {
    sourceDeviceListId: number;
    field: string;
    value: unknown;
    ts: string;
}

export interface BluetoothSourceTarget {
    sourceDeviceListId: number;
    componentKey: string;
}

interface BluetoothSourceSample extends BluetoothSourceTarget {
    ts: string;
    rssi: number | null;
    payload: Record<string, unknown>;
}

interface BluetoothWritableSample extends BluetoothSourceSample {
    bluDeviceListId: number;
    bluetoothExternalId: string;
    organizationId: string;
    transportId: string;
    gatewayExternalId: string;
    primary: boolean;
}

export interface BluetoothProvenanceContext {
    sourceDevices: readonly StatusSourceDevice[];
    legacySourceMetadata: boolean;
}

export interface BluetoothProvenanceResult {
    recorded: number;
    skipped: number;
    statusRows: BluetoothProjectedStatusRow[];
    organizationIds: string[];
}

export interface BluetoothProjectedStatusRow {
    deviceListId: number;
    tsSeconds: number;
    field: string;
    fieldGroup: string;
    value: number;
    prevValue: number;
}

const defaultDeps: BluetoothProvenanceDeps = {
    queryRows: postgres.queryRows
};
const BLUETOOTH_STATUS_FIELD_GROUP = 'bluetooth';

export async function recordBluetoothGatewayStatusBatch(
    entries: readonly BluetoothStatusBatchEntry[],
    input: {
        context?: BluetoothProvenanceContext;
        deps?: BluetoothProvenanceDeps;
    } = {}
): Promise<BluetoothProvenanceResult> {
    const deps = input.deps ?? defaultDeps;
    const samples = bluetoothSamplesFromBatch(entries);
    if (samples.length === 0) return emptyResult();
    const writable = await loadWritableBluetoothSamples({
        samples,
        context: input.context ?? {
            sourceDevices: [],
            legacySourceMetadata: true
        },
        deps
    });
    if (writable.length === 0) {
        return {
            recorded: 0,
            skipped: samples.length,
            statusRows: [],
            organizationIds: []
        };
    }
    const recorded = await insertBluetoothProvenanceRows({
        samples: writable,
        deps
    });
    return bluetoothProvenanceResult({
        sampleCount: samples.length,
        writable,
        recorded
    });
}

interface LoadWritableSamplesInput {
    samples: readonly BluetoothSourceSample[];
    context: BluetoothProvenanceContext;
    deps: BluetoothProvenanceDeps;
}

async function loadWritableBluetoothSamples(
    input: LoadWritableSamplesInput
): Promise<BluetoothWritableSample[]> {
    const sources = await completeGatewaySources(
        input.samples,
        input.context,
        input.deps
    );
    if (sources.length === 0) return [];
    const routerDeps: Partial<BluetoothTelemetryRouterDeps> = {};
    if (input.deps.loadRoutes) routerDeps.loadRoutes = input.deps.loadRoutes;
    if (input.deps.acceptTelemetrySources) {
        routerDeps.arbiter = {
            acceptMany: input.deps.acceptTelemetrySources
        };
    }
    const routing = await routeBluetoothTelemetry({
        sources,
        targets: input.samples,
        deps: routerDeps
    });
    return input.samples.flatMap((sample) =>
        writableSample(sample, routing.accepted.get(telemetryTargetKey(sample)))
    );
}

function writableSample(
    sample: BluetoothSourceSample,
    routed: {gatewayExternalId: string; route: BluetoothStatusRoute} | undefined
): BluetoothWritableSample[] {
    if (!routed) return [];
    return [
        {
            ...sample,
            bluDeviceListId: routed.route.deviceListId,
            bluetoothExternalId: routed.route.externalId,
            organizationId: routed.route.organizationId,
            transportId: routed.route.transportId,
            gatewayExternalId: routed.gatewayExternalId,
            primary: routed.route.primary
        }
    ];
}

async function completeGatewaySources(
    samples: readonly BluetoothSourceSample[],
    context: BluetoothProvenanceContext,
    deps: BluetoothProvenanceDeps
): Promise<BluetoothGatewayIdentity[]> {
    const sources = new Map(
        context.sourceDevices.map((source) => [
            source.deviceListId,
            source satisfies BluetoothGatewayIdentity
        ])
    );
    if (!context.legacySourceMetadata) return [...sources.values()];
    const missingIds = [
        ...new Set(
            samples
                .map((sample) => sample.sourceDeviceListId)
                .filter((id) => !sources.has(id))
        )
    ];
    if (missingIds.length === 0) return [...sources.values()];
    Observability.incrementCounter('blu_telemetry_legacy_source_queries_total');
    const legacy = await loadLegacyGatewaySources(missingIds, deps);
    for (const source of legacy) sources.set(source.deviceListId, source);
    return [...sources.values()];
}

async function loadLegacyGatewaySources(
    deviceListIds: readonly number[],
    deps: BluetoothProvenanceDeps
): Promise<BluetoothGatewayIdentity[]> {
    const rows = await deps.queryRows<{
        id: number;
        external_id: string;
        organization_id: string;
    }>(
        `SELECT id, external_id, organization_id
           FROM device.list
          WHERE id = ANY($1::integer[])
            AND organization_id IS NOT NULL`,
        [deviceListIds]
    );
    return rows.map((row) => ({
        deviceListId: row.id,
        externalId: row.external_id,
        organizationId: row.organization_id
    }));
}

interface InsertProvenanceInput {
    samples: readonly BluetoothWritableSample[];
    deps: BluetoothProvenanceDeps;
}

async function insertBluetoothProvenanceRows(
    input: InsertProvenanceInput
): Promise<number> {
    const rows = await input.deps.queryRows<{recorded: number | string}>(
        `WITH input_rows AS (
            SELECT
                (row->>'bluDeviceListId')::integer AS blu_device_list_id,
                row->>'componentKey' AS component_key,
                (row->>'transportId')::uuid AS transport_id,
                NULLIF(row->>'rssi', '')::integer AS rssi,
                (row->>'receivedAt')::timestamptz AS received_at,
                row->'payload' AS source_payload_json
              FROM jsonb_array_elements($1::jsonb) row
        ),
        -- One row per transport: UPDATE ... FROM with several matching rows
        -- applies an unpredictable one, so the newest sample is chosen here.
        transport_seen AS (
            SELECT
                transport_id,
                MAX(received_at) AS received_at,
                (ARRAY_AGG(rssi ORDER BY received_at DESC)
                    FILTER (WHERE rssi IS NOT NULL))[1] AS rssi
              FROM input_rows
             WHERE transport_id IS NOT NULL
             GROUP BY transport_id
        ),
        updated_transport AS (
            UPDATE device.blu_transport bt
               SET last_seen_at = GREATEST(
                       COALESCE(bt.last_seen_at, seen.received_at),
                       seen.received_at
                   ),
                   last_rssi = CASE
                       WHEN bt.last_seen_at IS NULL
                         OR seen.received_at >= bt.last_seen_at
                       THEN COALESCE(seen.rssi, bt.last_rssi)
                       ELSE bt.last_rssi
                   END,
                   updated_at = NOW()
              FROM transport_seen seen
             WHERE bt.id = seen.transport_id
             RETURNING bt.id
        ),
        inserted AS (
            INSERT INTO device.blu_sample_provenance (
                blu_device_list_id,
                component_key,
                transport_id,
                rssi,
                received_at,
                source_payload_json
            )
            SELECT
                blu_device_list_id,
                component_key,
                transport_id,
                rssi,
                received_at,
                source_payload_json
              FROM input_rows
             -- ORDER matters, and not for the output. Every row inserted here
             -- takes a FOR KEY SHARE lock on its device.blu_device parent to
             -- satisfy the foreign key. Two status batches draining at once that
             -- carry the same two BLU devices in different orders each hold one
             -- lock and wait for the other: deadlock 40P01, observed as
             --   "while locking tuple (8,3) in relation blu_device".
             -- Sorting by the parent key makes every transaction take those locks
             -- in the same order, so one waits instead of both dying.
             ORDER BY blu_device_list_id, component_key, received_at
            ON CONFLICT DO NOTHING
            RETURNING 1
        )
        SELECT COUNT(*) AS recorded FROM inserted`,
        [jsonbParam(provenanceInputRows(input.samples))]
    );
    return Number(rows[0]?.recorded ?? 0);
}

// Provenance answers "which gateway relayed this sample"; it is kept for a
// bounded window. Deletes walk the per-device time index in bounded batches.
export async function deleteExpiredBluetoothProvenance(
    input: {retentionDays: number; batchSize: number; maxBatches: number},
    deps: Pick<BluetoothProvenanceDeps, 'queryRows'> = defaultDeps
): Promise<number> {
    let deleted = 0;
    for (let batch = 0; batch < input.maxBatches; batch += 1) {
        const rows = await deps.queryRows<{deleted: number | string}>(
            `WITH expired AS (
                SELECT expired.id
                  FROM device.blu_device bd
                 CROSS JOIN LATERAL (
                    SELECT p.id
                      FROM device.blu_sample_provenance p
                     WHERE p.blu_device_list_id = bd.device_list_id
                       AND p.received_at < NOW() - make_interval(days => $1)
                     ORDER BY p.received_at
                     LIMIT $2
                 ) expired
                 LIMIT $2
            ),
            removed AS (
                DELETE FROM device.blu_sample_provenance p
                 USING expired
                 WHERE p.id = expired.id
                RETURNING 1
            )
            SELECT COUNT(*) AS deleted FROM removed`,
            [input.retentionDays, input.batchSize]
        );
        const count = Number(rows[0]?.deleted ?? 0);
        deleted += count;
        if (count < input.batchSize) break;
    }
    return deleted;
}

interface ProvenanceResultInput {
    sampleCount: number;
    writable: readonly BluetoothWritableSample[];
    recorded: number;
}

function bluetoothProvenanceResult(
    input: ProvenanceResultInput
): BluetoothProvenanceResult {
    return {
        recorded: input.recorded,
        skipped: Math.max(0, input.sampleCount - input.writable.length),
        statusRows: projectedStatusRows(input.writable),
        organizationIds: [
            ...new Set(input.writable.map((sample) => sample.organizationId))
        ]
    };
}

export function bluetoothProjectedStatusBatch(
    rows: readonly BluetoothProjectedStatusRow[]
): StatusBatch | null {
    if (rows.length === 0) return null;
    return {
        p_ts: rows.map((row) => row.tsSeconds),
        p_id: rows.map((row) => row.deviceListId),
        p_field: rows.map((row) => row.field),
        p_field_group: rows.map((row) => row.fieldGroup),
        p_value: rows.map((row) => row.value),
        p_prev_value: rows.map((row) => row.prevValue)
    };
}

function emptyResult(): BluetoothProvenanceResult {
    return {recorded: 0, skipped: 0, statusRows: [], organizationIds: []};
}

function provenanceInputRows(
    writable: readonly BluetoothWritableSample[]
): Array<Record<string, unknown>> {
    // Sorted by the parent key, matching the ORDER BY in the insert above. One
    // batch's samples arrive in whatever order the gateways reported them; two
    // batches meeting the same devices in opposite orders is what deadlocked on
    // the blu_device foreign key.
    return [...writable]
        .sort(
            (a, b) =>
                a.bluDeviceListId - b.bluDeviceListId ||
                a.componentKey.localeCompare(b.componentKey) ||
                a.ts.localeCompare(b.ts)
        )
        .map((row) => ({
            bluDeviceListId: row.bluDeviceListId,
            componentKey: row.componentKey,
            transportId: row.transportId,
            rssi: row.rssi,
            receivedAt: row.ts,
            payload: row.payload
        }));
}

function bluetoothSamplesFromBatch(
    entries: readonly BluetoothStatusBatchEntry[]
): BluetoothSourceSample[] {
    const samples = new Map<string, BluetoothSourceSample>();
    for (const entry of entries) {
        const split = splitStatusField(entry.field);
        if (!split || !isBluetoothSourceComponent(split.componentKey)) continue;
        const key = `${entry.sourceDeviceListId}\0${split.componentKey}\0${entry.ts}`;
        const sample =
            samples.get(key) ??
            ({
                sourceDeviceListId: entry.sourceDeviceListId,
                componentKey: split.componentKey,
                ts: entry.ts,
                rssi: null,
                payload: {}
            } satisfies BluetoothSourceSample);
        sample.payload[split.field] = entry.value;
        if (split.field === 'rssi' && typeof entry.value === 'number') {
            sample.rssi = Number.isFinite(entry.value) ? entry.value : null;
        }
        samples.set(key, sample);
    }
    return [...samples.values()];
}

function projectedStatusRows(
    writable: readonly BluetoothWritableSample[]
): BluetoothProjectedStatusRow[] {
    return writable.flatMap(projectSampleStatusRows);
}

function projectSampleStatusRows(
    sample: BluetoothWritableSample
): BluetoothProjectedStatusRow[] {
    const tsSeconds = epochSeconds(sample.ts);
    if (tsSeconds === null) return [];
    return Object.entries(sample.payload)
        .filter((entry): entry is [string, number] => finiteNumberEntry(entry))
        .map(([fieldName, value]) => ({
            deviceListId: sample.bluDeviceListId,
            tsSeconds,
            field: `${sample.componentKey}.${fieldName}`,
            fieldGroup: BLUETOOTH_STATUS_FIELD_GROUP,
            value,
            prevValue: value
        }));
}

function finiteNumberEntry(
    entry: [string, unknown]
): entry is [string, number] {
    return typeof entry[1] === 'number' && Number.isFinite(entry[1]);
}

function epochSeconds(value: string): number | null {
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) return null;
    return Math.trunc(millis / 1000);
}

function splitStatusField(
    field: string
): {componentKey: string; field: string} | null {
    const dot = field.lastIndexOf('.');
    if (dot <= 0 || dot === field.length - 1) return null;
    const componentKey = field.slice(0, dot);
    if (!/^[a-z][a-z0-9_]*:\d+$/.test(componentKey)) return null;
    return {componentKey, field: field.slice(dot + 1)};
}

function isBluetoothSourceComponent(componentKey: string): boolean {
    return (
        componentKey.startsWith('bthomedevice:') ||
        componentKey.startsWith('bthomesensor:') ||
        componentKey.startsWith('bthomecontrol:') ||
        componentKey.startsWith('blutrv:')
    );
}
