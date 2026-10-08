import {tuning} from '../../config';
import {emStatsQueue} from '../emStatsQueue';
import {positiveDelta} from '../energyCapture';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {
    type VirtualCounterRow,
    type VirtualOperationalMetricRow,
    type VirtualStatusEntry,
    virtualNumericRows
} from '../sensor/virtualSensorCapture';
import {deviceConfigResolver} from '../sensor/virtualSensorConfig';
import {captureSensorRows} from '../sensorCapture';
import {
    bluetoothProjectedStatusBatch,
    recordBluetoothGatewayStatusBatch
} from '../virtualDevice/bluetoothProvenance';
import {projectStatusBatch} from '../virtualDevice/historyProjection';
import {
    type StatusBatch,
    type StatusSourceDevice,
    statusBatchTimestampToIso
} from './batchCoalescer';
import {appendStatusBatch} from './StatusStream';

export interface ProjectedBluetoothStatusDeps {
    appendRedis(input: {
        batch: StatusBatch;
        organizationIds: readonly string[];
    }): Promise<void>;
    writePostgres(batch: StatusBatch): Promise<unknown>;
}

const projectedBluetoothStatusDeps: ProjectedBluetoothStatusDeps = {
    appendRedis: appendStatusBatch,
    writePostgres: (batch) =>
        PostgresProvider.rawCall('device.fn_status_push', batch)
};

export async function routeProjectedBluetoothStatus(
    batch: StatusBatch,
    organizationIds: readonly string[],
    redisFirst: boolean = tuning.status.redisFirst,
    deps: ProjectedBluetoothStatusDeps = projectedBluetoothStatusDeps
): Promise<void> {
    if (redisFirst) {
        await deps.appendRedis({batch, organizationIds});
        return;
    }
    await deps.writePostgres(batch);
}

export async function projectPersistedStatusBatch(
    batch: StatusBatch,
    context: {
        sourceDevices: readonly StatusSourceDevice[];
        legacySourceMetadata: boolean;
    } = {sourceDevices: [], legacySourceMetadata: true}
): Promise<void> {
    const organizationByDevice = new Map(
        context.sourceDevices.map((device) => [
            device.deviceListId,
            device.organizationId
        ])
    );
    const entries = [];
    for (let i = 0; i < batch.p_ts.length; i++) {
        const ts = statusBatchTimestampToIso(batch.p_ts[i] as number);
        if (!ts) continue;
        entries.push({
            sourceDeviceListId: batch.p_id[i] as number,
            organizationId: organizationByDevice.get(batch.p_id[i] as number),
            field: batch.p_field[i] as string,
            value: batch.p_value[i],
            prevValue: batch.p_prev_value[i],
            ts
        });
    }
    if (entries.length === 0) return;

    const [projection, bluetooth] = await Promise.all([
        projectStatusBatch(entries),
        recordBluetoothGatewayStatusBatch(entries, {context})
    ]);
    const bluetoothStatusBatch = bluetoothProjectedStatusBatch(
        bluetooth.statusRows
    );
    if (bluetoothStatusBatch) {
        await routeProjectedBluetoothStatus(
            bluetoothStatusBatch,
            bluetooth.organizationIds
        );
    }
    const projected =
        projection.projected + bluetooth.recorded + bluetooth.statusRows.length;
    if (projected > 0) {
        Observability.incrementCounter('virtual_projection_rows', projected);
    }
    await captureVirtualSensorHistory(batch, context.sourceDevices);
}

/**
 * Sends classified virtual-component readings to the forever sensor rollup.
 *
 * This runs off the persisted batch rather than the ingest loop so the reading
 * is only kept once PostgreSQL has already accepted it as status, and so the
 * rollup never sees a value that the 24-hour tier rejected.
 */
async function captureVirtualSensorHistory(
    batch: StatusBatch,
    sourceDevices: readonly StatusSourceDevice[]
): Promise<void> {
    if (!tuning.virtualCapture.rollup) return;
    const shellyIdByDeviceListId = new Map(
        sourceDevices.map((d) => [d.deviceListId, d.externalId])
    );
    const entries: VirtualStatusEntry[] = [];
    for (let i = 0; i < batch.p_ts.length; i++) {
        entries.push({
            deviceListId: batch.p_id[i] as number,
            field: batch.p_field[i] as string,
            value: batch.p_value[i],
            previousValue: batch.p_prev_value[i],
            ts: batch.p_ts[i] as number
        });
    }
    const {rows, events, counters, operationalMetrics, rejected} =
        virtualNumericRows(
            entries,
            deviceConfigResolver(shellyIdByDeviceListId)
        );
    for (const [reason, count] of rejected) {
        Observability.incrementCounter(
            `virtual_sensor_rejected_${reason}`,
            count
        );
    }
    enqueueVirtualCounters(counters);
    enqueueVirtualOperationalMetrics(operationalMetrics);
    if (rows.length === 0 && events.length === 0) return;
    Observability.incrementCounter(
        'virtual_sensor_rows_captured',
        rows.length + events.length
    );
    await captureSensorRows(
        {numeric: rows, events},
        {callDb: PostgresProvider.rawCall}
    );
}

function enqueueVirtualOperationalMetrics(
    metrics: readonly VirtualOperationalMetricRow[]
): void {
    for (const metric of metrics) {
        emStatsQueue.enqueue({
            deviceId: metric.deviceId,
            tag: metric.tag,
            domain: 'unspecified',
            phase: 'z',
            channel: metric.channel,
            ts: metric.ts,
            value: metric.value,
            isDelta: false
        });
        Observability.incrementCounter('virtual_operational_rows_captured');
    }
}

/**
 * Ages each cumulative meter reading into the increase since the last one and
 * hands it to the energy pipeline, which is where reset-safe counters already
 * live. `positiveDelta` is the pipeline's own rule, reused rather than repeated:
 * a first reading and a counter reset both yield nothing, so a meter the user
 * zeroes never books a negative or a spike.
 *
 * `domain` stays `unspecified` on purpose. The database derives the commodity
 * from the tag, and a volume tag already resolves to water there, so naming a
 * domain here would only invent a second, competing answer.
 */
function enqueueVirtualCounters(counters: readonly VirtualCounterRow[]): void {
    for (const counter of counters) {
        if (typeof counter.previousTotal !== 'number') continue;
        const delta = positiveDelta(counter.total, counter.previousTotal);
        if (delta === null) continue;
        emStatsQueue.enqueue({
            deviceId: counter.deviceId,
            tag: counter.tag,
            domain: 'unspecified',
            phase: 'z',
            channel: counter.channel,
            ts: counter.ts,
            value: delta,
            isDelta: true
        });
        Observability.incrementCounter('virtual_counter_rows_captured');
    }
}
