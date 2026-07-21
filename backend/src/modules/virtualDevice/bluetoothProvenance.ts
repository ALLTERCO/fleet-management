import * as postgres from '../PostgresProvider';
import {jsonbParam} from '../postgresJsonb';
import type {StatusBatch} from '../status/batchCoalescer';

export interface BluetoothProvenanceDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
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
}

export interface BluetoothSourceTargetRow {
    blu_device_list_id: number;
    bluetooth_external_id: string;
    organization_id: string;
    component_key: string;
    transport_id: string;
    source_device_list_id: number;
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
    deps: BluetoothProvenanceDeps = defaultDeps
): Promise<BluetoothProvenanceResult> {
    const samples = bluetoothSamplesFromBatch(entries);
    if (samples.length === 0) return emptyResult();
    const writable = await loadWritableBluetoothSamples({samples, deps});
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
    deps: BluetoothProvenanceDeps;
}

async function loadWritableBluetoothSamples(
    input: LoadWritableSamplesInput
): Promise<BluetoothWritableSample[]> {
    const transports = await resolveBluetoothSourceTargets(
        input.samples,
        input.deps
    );
    if (transports.length === 0) return [];
    return writableSamplesFromTransportSources(input.samples, transports);
}

function writableSamplesFromTransportSources(
    samples: readonly BluetoothSourceSample[],
    transports: readonly BluetoothSourceTargetRow[]
): BluetoothWritableSample[] {
    const indexed = indexTransportSources(transports);
    return samples.flatMap((sample) =>
        (indexed.get(sampleKey(sample)) ?? []).map((transport) => ({
            ...sample,
            bluDeviceListId: transport.blu_device_list_id,
            bluetoothExternalId: transport.bluetooth_external_id,
            organizationId: transport.organization_id,
            transportId: transport.transport_id
        }))
    );
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
        updated_transport AS (
            UPDATE device.blu_transport bt
               SET last_seen_at = GREATEST(
                       COALESCE(bt.last_seen_at, input_rows.received_at),
                       input_rows.received_at
                   ),
                   last_rssi = COALESCE(input_rows.rssi, bt.last_rssi),
                   updated_at = NOW()
              FROM input_rows
             WHERE bt.id = input_rows.transport_id
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
            ON CONFLICT DO NOTHING
            RETURNING 1
        )
        SELECT COUNT(*) AS recorded FROM inserted`,
        [jsonbParam(provenanceInputRows(input.samples))]
    );
    return Number(rows[0]?.recorded ?? 0);
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
    return writable.map((row) => ({
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

export async function resolveBluetoothSourceTargets(
    samples: readonly BluetoothSourceTarget[],
    deps: BluetoothProvenanceDeps = defaultDeps
): Promise<BluetoothSourceTargetRow[]> {
    const targets = uniqueTargets(samples);
    if (targets.length === 0) return [];
    return deps.queryRows<BluetoothSourceTargetRow>(
        `WITH targets AS (
            SELECT *
              FROM UNNEST($1::integer[], $2::varchar[])
                AS t(source_device_list_id, component_key)
        )
        SELECT
            bd.device_list_id AS blu_device_list_id,
            target_device.external_id AS bluetooth_external_id,
            bd.organization_id,
            component->>'componentKey' AS component_key,
            bt.id AS transport_id,
            bt.shelly_device_list_id AS source_device_list_id
          FROM device.blu_device bd
          JOIN device.blu_transport bt
            ON bt.blu_device_list_id = bd.device_list_id
           AND bt.organization_id = bd.organization_id
           AND bt.mode = 'bthome_gateway'
           AND bt.enabled IS TRUE
          JOIN device.list target_device
            ON target_device.id = bd.device_list_id
           AND target_device.organization_id = bd.organization_id
          JOIN targets t
            ON t.source_device_list_id = bt.shelly_device_list_id
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(bd.source_components_json, '[]'::jsonb)
          ) component
         WHERE bd.deleted_at IS NULL
           AND component->>'componentKey' = t.component_key`,
        [
            targets.map((target) => target.sourceDeviceListId),
            targets.map((target) => target.componentKey)
        ]
    );
}

function uniqueTargets(
    samples: readonly BluetoothSourceTarget[]
): BluetoothSourceTarget[] {
    const byKey = new Map<string, BluetoothSourceTarget>();
    for (const sample of samples) {
        byKey.set(sampleKey(sample), sample);
    }
    return [...byKey.values()];
}

function indexTransportSources(
    rows: readonly BluetoothSourceTargetRow[]
): Map<string, BluetoothSourceTargetRow[]> {
    const out = new Map<string, BluetoothSourceTargetRow[]>();
    for (const row of rows) {
        const key = sampleKey({
            sourceDeviceListId: row.source_device_list_id,
            componentKey: row.component_key
        });
        const bucket = out.get(key) ?? [];
        bucket.push(row);
        out.set(key, bucket);
    }
    return out;
}

function sampleKey(sample: BluetoothSourceTarget): string {
    return `${sample.sourceDeviceListId}\0${sample.componentKey}`;
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
