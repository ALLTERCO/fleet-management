// Boot registers the saved devices once, so a row that could not be built
// then stayed invisible until the next restart. A timer re-reads the store and
// registers what is missing, which also picks up rows written out-of-band.

import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import * as DeviceCollector from '../DeviceCollector';
import * as Observability from '../Observability';
import {loadSavedDevices} from '../PostgresProvider';
import {runContained, safeInterval} from '../util/faultGuard';

const SOURCE = 'deviceLoadReconcile';

const logger = getLogger('device-load-reconcile');

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
    const before = new Set(DeviceCollector.getAllShellyIDs());
    // skipRegistered is load-bearing: register() destroys and replaces a live
    // device, so a plain re-load would tear down every connected device.
    const registered = await loadSavedDevices({skipRegistered: true});
    if (registered === 0) return;
    const recovered = DeviceCollector.getAll()
        .map((device) => device.shellyID)
        .filter((shellyID) => !before.has(shellyID));
    Observability.incrementCounter(
        'device_load_reconcile_recovered',
        registered
    );
    logger.error(
        'device load reconcile registered %s saved device(s) missing from memory: %s',
        registered,
        recovered.join(', ')
    );
}

/** Start the reconcile. A zero interval disables it. */
export function start(): void {
    const intervalMs = tuning.device.loadReconcileMs;
    if (intervalMs <= 0 || timer) return;
    timer = safeInterval(SOURCE, intervalMs, runOnce);
    timer.unref();
    logger.info('device load reconcile every %s ms', intervalMs);
    // Run at once: a boot gap should not wait a whole interval to be closed.
    runContained(SOURCE, runOnce);
}

export function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
}
