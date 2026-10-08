import {Histogram} from 'prom-client';
import {registry} from './registry';
import {getLevel} from './samplers';

// The device's own app code labels the series. Only meters with emdata or
// em1data components push, so the count stays at the EM product codes in use.
const MODEL_LABEL_MAX = 32;
const UNKNOWN_MODEL = 'unknown';

const pushDelay = new Histogram({
    name: 'fm_em_sync_push_delay_seconds',
    help: 'Time from the end of a pushed EM meter record to its receipt, by meter model',
    labelNames: ['model'],
    buckets: [0.5, 1, 2, 3, 5, 10, 20, 30, 60, 120, 300],
    registers: [registry]
});

export function emModelLabel(app: string | undefined): string {
    const safe = (app ?? '')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .slice(0, MODEL_LABEL_MAX);
    return safe || UNKNOWN_MODEL;
}

export function recordEmSyncPushDelay(
    delaySeconds: number,
    app: string | undefined
): void {
    if (getLevel() < 1 || delaySeconds < 0) return;
    pushDelay.observe({model: emModelLabel(app)}, delaySeconds);
}
