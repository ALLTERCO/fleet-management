// Seeds the energyOverrideCache from fm.energy_classification at
// startup so the hot path is a pure cache read. Re-runs are safe
// (replaces existing entries); a per-device variant lets the
// SetClassification / DeleteClassification handlers refresh just the
// affected device without re-reading the whole table.

import * as log4js from 'log4js';
import type {EnergyClassificationRow} from '../types/api/energy';
import {energyOverrideCache} from './energyOverrideCache';
import {listClassifications} from './repositories/EnergyClassificationRepository';

const logger = log4js.getLogger('energy-override-loader');

export async function seedAllOverrides(): Promise<void> {
    try {
        const rows = await listClassificationsWithRetry();
        seedFromRows(rows);
        logger.info('Seeded %d energy-classification overrides', rows.length);
    } catch (e) {
        if (isMigrationPendingError(e)) {
            logger.debug(
                'fm.fn_list_energy_classifications missing — leaving energy-classification cache empty for this boot.'
            );
            return;
        }
        throw e;
    }
}

const RETRY_DELAY_MS = 250;

// initDatabase applies migrations before seedAllOverrides runs, but pg
// tx-visibility can still report "function missing" for ~50ms after the
// migration commits. One short retry closes that window.
async function listClassificationsWithRetry() {
    try {
        return await listClassifications();
    } catch (e) {
        if (!isMigrationPendingError(e)) throw e;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return listClassifications();
    }
}

// PostgresProvider surfaces a missing function as Error('MethodNotFound').
function isMigrationPendingError(e: unknown): boolean {
    return e instanceof Error && e.message === 'MethodNotFound';
}

export async function refreshDeviceOverrides(deviceId: number): Promise<void> {
    const rows = await listClassifications(deviceId);
    energyOverrideCache.seedDevice(deviceId, rows);
}

function seedFromRows(rows: ReadonlyArray<EnergyClassificationRow>): void {
    const grouped = new Map<number, EnergyClassificationRow[]>();
    for (const row of rows) {
        const bucket = grouped.get(row.deviceId);
        if (bucket) bucket.push(row);
        else grouped.set(row.deviceId, [row]);
    }
    for (const [deviceId, bucket] of grouped) {
        energyOverrideCache.seedDevice(deviceId, bucket);
    }
}
