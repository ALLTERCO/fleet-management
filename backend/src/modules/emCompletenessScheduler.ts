// Periodic EM completeness check, leader-gated so one process sweeps the fleet.
import * as log4js from 'log4js';
import {envFloat, envInt} from '../config/envReader';
import {
    bootstrapEmCoverage,
    type CallDb,
    type EmCompletenessSettings,
    sweepEmCompleteness
} from './emCompleteness';
import * as Observability from './Observability';
import * as PostgresProvider from './PostgresProvider';
import {isLeader, startLeaderGate} from './redis/leaderGate';

const logger = log4js.getLogger('EmCompletenessScheduler');
const LEADER_NAME = 'em-completeness-scheduler';

const INTERVAL_MS = envInt('FM_EM_COMPLETENESS_INTERVAL_MS', 60 * 60 * 1000);
const SETTINGS: EmCompletenessSettings = {
    // Holes younger than this are left to the gap fill.
    settleMs: envInt('FM_EM_COMPLETENESS_SETTLE_MS', 30 * 60 * 1000),
    maxSpanMs: envInt('FM_EM_COMPLETENESS_MAX_SPAN_MS', 24 * 60 * 60 * 1000),
    counterLookbackMs: envInt(
        'FM_EM_COUNTER_CHECK_LOOKBACK_MS',
        24 * 60 * 60 * 1000
    ),
    counterTolerancePct: envFloat(
        'FM_EM_COUNTER_CHECK_TOLERANCE_PCT',
        2,
        0,
        100
    )
};

// Soon after start, so record coverage of existing channels is built after a
// deploy without waiting for the first hourly sweep; never on the boot path.
const COVERAGE_BOOTSTRAP_DELAY_MS = 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let bootstrapTimer: NodeJS.Timeout | null = null;
let running = false;

// A failure leaves the rest to writers and the next sweep.
async function runCoverageBootstrap(callDb: CallDb): Promise<void> {
    try {
        const built = await bootstrapEmCoverage(callDb);
        if (built > 0) {
            logger.info('em record coverage built for %d channel(s)', built);
        }
    } catch (err) {
        Observability.incrementCounter('em_completeness_sweep_errors');
        logger.error('em record coverage bootstrap failed: %s', err);
    }
}

async function runSweep(deps?: {callDb?: CallDb}): Promise<void> {
    if (!isLeader(LEADER_NAME)) return;
    const callDb = deps?.callDb ?? PostgresProvider.callMethod;
    await runCoverageBootstrap(callDb);
    try {
        const result = await sweepEmCompleteness({
            callDb,
            nowMs: Date.now(),
            settings: SETTINGS
        });
        if (result.findings > 0 || result.failures > 0) {
            logger.warn(
                'em completeness: %d channel(s), %d new incomplete range(s), %d failure(s)',
                result.channelsChecked,
                result.findings,
                result.failures
            );
        }
    } catch (err) {
        Observability.incrementCounter('em_completeness_sweep_errors');
        logger.error('em completeness sweep failed: %s', err);
    }
}

export function startScheduler(): void {
    if (running) {
        logger.warn('EM completeness scheduler already running');
        return;
    }
    running = true;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(() => {
        void runSweep();
    }, INTERVAL_MS);
    timer.unref?.();
    bootstrapTimer = setTimeout(() => {
        if (isLeader(LEADER_NAME)) {
            void runCoverageBootstrap(PostgresProvider.callMethod);
        }
    }, COVERAGE_BOOTSTRAP_DELAY_MS);
    bootstrapTimer.unref?.();
    logger.info(
        'EM completeness scheduler started (interval=%dms)',
        INTERVAL_MS
    );
}

export function stopScheduler(): void {
    running = false;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    if (bootstrapTimer) {
        clearTimeout(bootstrapTimer);
        bootstrapTimer = null;
    }
    logger.info('EM completeness scheduler stopped');
}

export function isRunning(): boolean {
    return running;
}

// Test seam — run one leader-gated tick without a timer.
export async function __runSweepForTests(deps?: {
    callDb?: CallDb;
}): Promise<void> {
    await runSweep(deps);
}

Observability.registerModule('emCompletenessScheduler', {
    stats: () => ({running: running ? 1 : 0}),
    topology: {
        role: 'service',
        cluster: 'services',
        zone: 'operations',
        upstreams: ['dbPool'],
        label: 'EM Completeness Check',
        description:
            'Minute-record and lifetime-counter completeness of EM history',
        route: '/monitoring/services'
    }
});
