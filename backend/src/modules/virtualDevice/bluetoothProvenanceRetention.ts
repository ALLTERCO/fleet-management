import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {createLeaderPollWorker} from '../worker/leaderPollWorker';
import {deleteExpiredBluetoothProvenance} from './bluetoothProvenance';

const logger = log4js.getLogger('blu-provenance-retention');
const LEADER_NAME = 'blu-provenance-retention';
const SWEEP_INTERVAL_MS = 10 * 60_000;
// Up to 40,000 rows per sweep: short transactions, well above the write rate.
const DELETE_BATCH_SIZE = 2_000;
const DELETE_MAX_BATCHES = 20;

const worker = createLeaderPollWorker({
    leaderName: LEADER_NAME,
    logger,
    pollIntervalMs: () => SWEEP_INTERVAL_MS,
    tick: sweepExpiredBluetoothProvenance
});

export async function startBluetoothProvenanceRetention(): Promise<void> {
    await worker.start();
}

export function stopBluetoothProvenanceRetention(): void {
    worker.stop();
}

export async function sweepExpiredBluetoothProvenance(): Promise<number> {
    const deleted = await deleteExpiredBluetoothProvenance({
        retentionDays: tuning.virtualDevice.bluProvenanceRetentionDays,
        batchSize: DELETE_BATCH_SIZE,
        maxBatches: DELETE_MAX_BATCHES
    });
    if (deleted > 0) {
        logger.info('removed %d expired BLU provenance rows', deleted);
    }
    return deleted;
}
