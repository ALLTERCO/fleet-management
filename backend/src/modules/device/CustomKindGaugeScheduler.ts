// Periodic refresh of the `fm_custom_kind_in_use` gauge: how many distinct
// custom kinds are currently assigned to a device or group, fleet-wide. The
// value is DB-derived, so it is queried on an interval (a mutation-only gauge
// would read stale after a restart). Leader-gated so only one instance writes.

import * as log4js from 'log4js';
import {
    countCustomKindsInUse,
    type KindRepositoryDeps
} from '../kindRepository';
import * as Observability from '../Observability';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {formatError} from '../util/formatError';

const LEADER_NAME = 'custom-kind-gauge';
const GAUGE_NAME = 'custom_kind_in_use';

const logger = log4js.getLogger('CustomKindGaugeScheduler');

let timer: NodeJS.Timeout | null = null;
let running = false;

// Pure refresh — exported so a unit test drives it with an injected query.
export async function refreshGauge(deps?: KindRepositoryDeps): Promise<void> {
    try {
        Observability.setGauge(GAUGE_NAME, await countCustomKindsInUse(deps));
    } catch (err) {
        // Counter so a chronically failing query is visible on /metrics, not
        // only in logs (the gauge would otherwise just freeze at its last value).
        Observability.incrementCounter('custom_kind_gauge_refresh_errors');
        logger.error('custom-kind gauge refresh failed: %s', formatError(err));
    }
}

async function runOnce(): Promise<void> {
    if (!isLeader(LEADER_NAME)) return;
    await refreshGauge();
}

/** Start the periodic refresh. Safe to call multiple times. */
export function start(intervalMs: number): void {
    if (running) return;
    running = true;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(() => {
        void runOnce();
    }, intervalMs);
    timer.unref();
    logger.info(
        'custom-kind gauge scheduler started — every %d ms',
        intervalMs
    );
}

/** Stop the scheduler. */
export function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    running = false;
}
