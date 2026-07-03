// Periodic VEE sum-check: reconcile live vs em-sync energy per device and flag
// drift. Leader-gated so only one pod runs the fleet-wide check.
import * as log4js from 'log4js';
import {envInt} from '../config/envReader';
import {type CallDb, sweepEmSumCheck} from './emSumCheck';
import * as Observability from './Observability';
import * as PostgresProvider from './PostgresProvider';
import {isLeader, startLeaderGate} from './redis/leaderGate';

const logger = log4js.getLogger('EmSumCheckScheduler');
const LEADER_NAME = 'em-sum-check-scheduler';

const INTERVAL_MS = envInt('FM_EM_SUMCHECK_INTERVAL_MS', 60 * 60 * 1000);
const LOOKBACK_MS = envInt('FM_EM_SUMCHECK_LOOKBACK_MS', 2 * 60 * 60 * 1000);
const TOLERANCE_PCT = envInt('FM_EM_SUMCHECK_TOLERANCE_PCT', 2);

let timer: NodeJS.Timeout | null = null;
let running = false;

// Devices with a sync bookmark — the set that em-syncs and can be reconciled.
export async function listSyncedDevices(): Promise<number[]> {
    const rows = await PostgresProvider.queryRows(
        'SELECT DISTINCT device FROM device_em.sync',
        []
    );
    return rows
        .map((r) => Number((r as {device: unknown}).device))
        .filter((n) => Number.isInteger(n));
}

async function runSweep(deps?: {
    callDb?: CallDb;
    listDeviceIds?: () => Promise<readonly number[]>;
}): Promise<void> {
    if (!isLeader(LEADER_NAME)) return;
    try {
        const result = await sweepEmSumCheck({
            callDb: deps?.callDb ?? PostgresProvider.callMethod,
            listDeviceIds: deps?.listDeviceIds ?? listSyncedDevices,
            nowMs: Date.now(),
            lookbackMs: LOOKBACK_MS,
            tolerancePct: TOLERANCE_PCT
        });
        if (result.exceptions > 0 || result.failures > 0) {
            logger.warn(
                'em sum-check: %d device(s), %d drift exception(s), %d failure(s)',
                result.devicesChecked,
                result.exceptions,
                result.failures
            );
        }
    } catch (err) {
        Observability.incrementCounter('em_sum_check_sweep_errors');
        logger.error('em sum-check sweep failed: %s', err);
    }
}

export function startScheduler(): void {
    if (running) {
        logger.warn('EM sum-check scheduler already running');
        return;
    }
    running = true;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(() => {
        void runSweep();
    }, INTERVAL_MS);
    timer.unref?.();
    logger.info('EM sum-check scheduler started (interval=%dms)', INTERVAL_MS);
}

export function stopScheduler(): void {
    running = false;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    logger.info('EM sum-check scheduler stopped');
}

export function isRunning(): boolean {
    return running;
}

// Test seam — run one leader-gated tick without a timer.
export async function __runSweepForTests(deps?: {
    callDb?: CallDb;
    listDeviceIds?: () => Promise<readonly number[]>;
}): Promise<void> {
    await runSweep(deps);
}

Observability.registerModule('emSumCheckScheduler', {
    stats: () => ({running: running ? 1 : 0}),
    topology: {
        role: 'service',
        cluster: 'services',
        zone: 'operations',
        upstreams: ['dbPool'],
        label: 'EM Sum-Check Scheduler',
        description: 'Live-vs-em-sync energy reconciliation',
        route: '/monitoring/services'
    }
});
