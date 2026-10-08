// The product reports its own problems: every tick it reads its counters
// and the dead letter table, then opens or clears one alert per check in
// every organization that has a system_health rule. Symptom first, action
// next to it, one open alert per check, cleared when the condition is gone.

import log4js from 'log4js';
import {tuning} from '../../config';
import * as AlertEngine from '../AlertEngine';
import * as Observability from '../Observability';
import type {CounterName} from '../observability/counters';
import * as PostgresProvider from '../PostgresProvider';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {countOpenRejectedBlocksAll} from '../repositories/EmSyncRejectedRepository';

const logger = log4js.getLogger('system-health');
const LEADER_NAME = 'system-health-sweep';
const KIND = 'system_health';

export interface HealthCheckResult {
    check: string;
    firing: boolean;
    title: string;
    message: string;
    metric: string;
    value: number;
    action: string;
}

export interface HealthCheckInputs {
    counters: (name: CounterName) => number;
    openRejectedBlocks: () => Promise<number>;
    rejectedBlocksMin: number;
}

// A counter that grew since the last tick means the condition is live now.
const lastSeen = new Map<CounterName, number>();

function grewSinceLastTick(
    read: HealthCheckInputs['counters'],
    name: CounterName
): number {
    const current = read(name);
    const previous = lastSeen.get(name) ?? current;
    lastSeen.set(name, current);
    return current - previous;
}

export async function runHealthChecks(
    inputs: HealthCheckInputs
): Promise<HealthCheckResult[]> {
    const rejected = await inputs.openRejectedBlocks();
    const dropped = grewSinceLastTick(inputs.counters, 'em_stats_data_dropped');
    const spilled = grewSinceLastTick(
        inputs.counters,
        'em_stats_overflow_spilled'
    );
    const saturated = grewSinceLastTick(
        inputs.counters,
        'audit_overflow_saturated'
    );
    return [
        {
            check: 'em-sync-rejected-open',
            firing: rejected >= inputs.rejectedBlocksMin,
            title: 'Rejected meter blocks are waiting',
            message: `${rejected} meter history blocks were refused by the database and are kept aside.`,
            metric: 'device_em.sync_rejected open rows',
            value: rejected,
            action: 'Open the rejected blocks list, fix the cause, then queue them again.'
        },
        {
            check: 'em-stats-dropped',
            firing: dropped > 0,
            title: 'Live energy readings were lost',
            message: `${dropped} live energy rows were dropped because the database stayed unreachable past the age limit.`,
            metric: 'fm_em_stats_data_dropped_total',
            value: dropped,
            action: 'Check the database. Readings older than the age limit cannot be recovered.'
        },
        {
            check: 'em-stats-overflow',
            firing: spilled > 0,
            title: 'Live energy readings are waiting in Redis',
            message: `${spilled} batches of live energy rows moved to the overflow stream because the database is slow or down.`,
            metric: 'fm_em_stats_overflow_spilled_total',
            value: spilled,
            action: 'Check the database. The rows are written once it accepts writes again.'
        },
        {
            check: 'audit-overflow-saturated',
            firing: saturated > 0,
            title: 'Audit log overflow is full',
            message:
                'The audit overflow stream reached its cap. New audit entries that do not fit are refused.',
            metric: 'fm_audit_overflow_saturated_total',
            value: saturated,
            action: 'Restore database throughput so the audit drainer can catch up.'
        }
    ];
}

async function organizationsWithRule(): Promise<string[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_orgs_with_kind',
        {p_kind: KIND}
    );
    const rows = (result?.rows ?? []) as Array<{organization_id: string}>;
    return rows.map((row) => row.organization_id);
}

// Only a change is reported: a check that keeps firing is not re-sent, a
// check that stops firing sends one resolved event.
const firingChecks = new Set<string>();

export async function publishHealthChecks(
    results: HealthCheckResult[],
    organizations: string[],
    report: typeof AlertEngine.reportSystemHealth = AlertEngine.reportSystemHealth
): Promise<void> {
    for (const result of results) {
        const wasFiring = firingChecks.has(result.check);
        if (result.firing === wasFiring) continue;
        if (result.firing) firingChecks.add(result.check);
        else firingChecks.delete(result.check);
        const {firing, ...event} = result;
        for (const organizationId of organizations) {
            await report(organizationId, {
                status: firing ? 'firing' : 'resolved',
                ...event
            });
        }
    }
}

export function resetSystemHealthStateForTests(): void {
    lastSeen.clear();
    firingChecks.clear();
}

async function tick(): Promise<void> {
    if (!isLeader(LEADER_NAME)) return;
    try {
        const results = await runHealthChecks({
            counters: Observability.getCounter,
            openRejectedBlocks: countOpenRejectedBlocksAll,
            rejectedBlocksMin: tuning.alert.systemHealthRejectedBlocksMin
        });
        const organizations = await organizationsWithRule();
        if (organizations.length === 0) return;
        await publishHealthChecks(results, organizations);
    } catch (err) {
        logger.error('system health sweep failed: %s', err);
    }
}

let timer: NodeJS.Timeout | undefined;

export function startSystemHealthSweep(): void {
    const intervalMs = tuning.alert.systemHealthSweepMs;
    if (timer || intervalMs <= 0) return;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(() => {
        void tick();
    }, intervalMs);
    timer.unref?.();
}

export function stopSystemHealthSweep(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
}
