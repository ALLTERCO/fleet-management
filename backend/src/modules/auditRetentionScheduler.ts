// Leader-elected sweep (logging.fn_sweep_audit): device-referenced rows honor
// their group's retention, device-less rows fall to a global fallback. The
// blanket Timescale policy is only a safety ceiling.
import * as log4js from 'log4js';
import {groupPolicy} from '../config/groupPolicy';
import {tuning} from '../config/tuning';
import * as Observability from './Observability';
import * as PostgresProvider from './PostgresProvider';
import {isLeader, startLeaderGate} from './redis/leaderGate';

const logger = log4js.getLogger('AuditRetentionScheduler');
const LEADER_NAME = 'audit-retention-scheduler';

let timer: NodeJS.Timeout | null = null;
let running = false;

// Group-policy defaults passed as fn_sweep_audit fallbacks; the SQL resolves
// per-row days from group metadata first and uses these only when none apply.
function sweepParams(): Record<string, number | null> {
    const p = groupPolicy();
    return {
        p_fallback_days: p.auditRetentionFallbackDays,
        p_default_standard: p.auditRetentionDaysByType.standard,
        p_default_operational: p.auditRetentionDaysByType.operational,
        p_default_critical: p.auditRetentionDaysByType.critical,
        p_default_custom: p.auditRetentionDaysByType.custom
    };
}

async function sweep(): Promise<void> {
    const result = await PostgresProvider.callMethod(
        'logging.fn_sweep_audit',
        sweepParams()
    );
    const deleted = Number(PostgresProvider.extractScalar(result?.rows)) || 0;
    Observability.incrementCounter('audit_retention_swept', deleted);
    logger.info('audit retention sweep deleted %d row(s)', deleted);
}

// Leader-only — without this every pod would run the fleet-wide DELETE.
async function runSweep(): Promise<void> {
    if (!isLeader(LEADER_NAME)) {
        logger.debug('skipping audit retention sweep — not leader');
        return;
    }
    try {
        await sweep();
    } catch (err) {
        Observability.incrementCounter('audit_retention_sweep_errors');
        logger.error('audit retention sweep failed: %s', err);
    }
}

export function startScheduler(): void {
    if (running) {
        logger.warn('Audit retention scheduler already running');
        return;
    }
    running = true;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(() => {
        void runSweep();
    }, tuning.auditRetention.sweepIntervalMs);
    timer.unref?.();
    logger.info(
        'Audit retention scheduler started (interval=%dms)',
        tuning.auditRetention.sweepIntervalMs
    );
}

export function stopScheduler(): void {
    running = false;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    logger.info('Audit retention scheduler stopped');
}

export function isRunning(): boolean {
    return running;
}

// Test seam — exercise the leader-gated tick without a real timer/Redis lease.
export async function __runSweepForTests(): Promise<void> {
    await runSweep();
}

Observability.registerModule('auditRetentionScheduler', {
    stats: () => ({
        running: running ? 1 : 0
    }),
    topology: {
        role: 'service',
        cluster: 'services',
        zone: 'operations',
        upstreams: ['dbPool'],
        label: 'Audit Retention Scheduler',
        description: 'Per-device audit retention sweep',
        route: '/monitoring/services'
    }
});
