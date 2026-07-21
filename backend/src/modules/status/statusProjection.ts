import {tuning} from '../../config';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {
    bluetoothProjectedStatusBatch,
    recordBluetoothGatewayStatusBatch
} from '../virtualDevice/bluetoothProvenance';
import {projectStatusBatch} from '../virtualDevice/historyProjection';
import {type StatusBatch, statusBatchTimestampToIso} from './batchCoalescer';
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
    batch: StatusBatch
): Promise<void> {
    const entries = [];
    for (let i = 0; i < batch.p_ts.length; i++) {
        const ts = statusBatchTimestampToIso(batch.p_ts[i] as number);
        if (!ts) continue;
        entries.push({
            sourceDeviceListId: batch.p_id[i] as number,
            field: batch.p_field[i] as string,
            value: batch.p_value[i],
            prevValue: batch.p_prev_value[i],
            ts
        });
    }
    if (entries.length === 0) return;

    const [projection, bluetooth] = await Promise.all([
        projectStatusBatch(entries),
        recordBluetoothGatewayStatusBatch(entries)
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
}
