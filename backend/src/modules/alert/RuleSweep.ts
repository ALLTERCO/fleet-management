// RuleSweep — periodic, leader-gated evaluation of time/absence kinds
// (heartbeat, rate_of_change, stuck_sensor) that no device event can trigger.
// Reads in-memory devices, fires synthetic matches through the engine.
import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import type AbstractDevice from '../../model/AbstractDevice';
import {createAttributeWindowRepo} from '../../model/analytics/attributeWindowRepo';
import {pickAggregateBucket} from '../../model/analytics/bucketPick';
import type {AlertRuleKind, ScopeSelector} from '../../types/api/alert';
import type {BluetoothDeviceDto} from '../../types/api/virtualdevice';
import {
    createSweepAlertResolver,
    ingestSweepMatch,
    markEvaluationState,
    offlineForSecOf,
    type PreparedAlertResolution,
    resolveFingerprint,
    sweepRulesFor
} from '../AlertEngine';
import {BoundedMap} from '../boundedMap';
import * as DeviceCollector from '../DeviceCollector';
import {countDbCalls} from '../dbCallCount';
import {runAsDbWorkload} from '../dbWorkPriority';
import * as OutboxWorker from '../delivery/OutboxWorker';
import {listExpiringCredentials} from '../deviceIngress/deviceIngressRepository';
import {getDeviceOrg} from '../EventDistributor';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {readVirtualConsumptionWindowsKWh} from '../virtualDevice/consumptionWindow';
import {
    claimCostBudgetThreshold,
    costBudgetConfig,
    costBudgetThresholdMatch,
    crossedCostBudgetThresholds,
    readActualCostBudgetSpend,
    releaseCostBudgetThresholdClaim,
    selectCostBudgetTargetDevice
} from './costBudget';
import {capabilityViewOf, deviceSupportsKind} from './deviceCapability';
import {
    deviceSnapshotFromStoredRow,
    promotedComponentsByGateway,
    storedDeviceSnapshots
} from './deviceSnapshots';
import {
    credentialExpiringFingerprint,
    synthesizeCredentialExpiring
} from './evaluators/credentialExpiring';
import {buildDeviceOfflineMatch} from './evaluators/deviceOffline';
import {synthesizeEnergyConsumptionThreshold} from './evaluators/energyConsumptionThreshold';
import {synthesizeHeartbeatMiss} from './evaluators/heartbeat';
import {synthesizeRateOfChangeMiss} from './evaluators/rateOfChange';
import {ruleFieldKey} from './evaluators/ruleFieldCache';
import {readNumber} from './evaluators/shared';
import {synthesizeStuckSensorMiss} from './evaluators/stuckSensor';
import {
    canonicalizeAlertMatch,
    type LogicalDeviceHint
} from './logicalDeviceFingerprint';
import {
    approachingNewPeakConfig,
    approachingNewPeakMatch,
    isPastRecordDeadline,
    latestRoleReadingAt,
    readDemandPeakComparison,
    readingIsFromLocalToday,
    recordIncompleteConfig,
    recordIncompleteMatch
} from './operationalHistory';
import {bluetoothDevicesForPresence, deviceReachability} from './reachability';
import {matchesScope} from './scope';
import {type StoredPresenceRow, storedDevicePresence} from './storedPresence';
import {resolveSubjectForEvent} from './subjectForEvent';
import {type SweepPacer, SweepTick} from './sweepPacer';
import {
    computeRate,
    heartbeatMissed,
    type Sample,
    sampleAtOrBefore,
    stuckFor
} from './sweepSampling';
import {BLUETOOTH_KIND, type LoadedAlertRule, type MatchResult} from './types';

const logger = log4js.getLogger('RuleSweep');
const LEADER_NAME = 'alert-sweep';

/** Kinds whose trigger is time/absence-based, so only the sweep can fire them. */
export const SWEEP_KINDS: readonly AlertRuleKind[] = [
    'device_offline',
    'heartbeat',
    'energy_consumption_threshold',
    'cost_budget_threshold',
    'record_incomplete',
    'approaching_new_peak',
    'rate_of_change',
    'stuck_sensor',
    'credential_expiring'
];

let timer: NodeJS.Timeout | null = null;
let started = false;
let tickInProgress = false;
let runningTick: SweepTick | null = null;
// Work units the last scheduled tick admitted; the next one paces to it.
let lastTickUnits = 0;
const lastRuleCompletedAt = new Map<number, number>();

export interface BoundedSweepResult {
    completed: number;
    deadlineReached: boolean;
}

/**
 * Schedules bounded batches without starting more work after the sweep
 * deadline. Already-started evaluations are allowed to finish.
 */
export async function runBoundedSweep<T, R = void>(
    tasks: readonly T[],
    run: (task: T) => Promise<R>,
    options: {
        concurrency: number;
        batchSize: number;
        deadlineMs: number;
        clock?: () => number;
        /** Spreads the batches of a scheduled tick over its window. */
        pacer?: SweepPacer;
    },
    completeBatch?: (results: readonly R[]) => Promise<void>
): Promise<BoundedSweepResult> {
    const clock = options.clock ?? Date.now;
    const concurrency = Math.max(1, Math.floor(options.concurrency));
    const batchSize = Math.max(1, Math.floor(options.batchSize));
    const {pacer} = options;
    let completed = 0;
    let active = 0;
    Observability.setGauge('alert_sweep_queue_size', tasks.length);
    Observability.setGauge('alert_sweep_active', 0);

    try {
        for (let offset = 0; offset < tasks.length; offset += batchSize) {
            const batch = tasks.slice(offset, offset + batchSize);
            if (clock() < options.deadlineMs) await pacer?.admit(batch.length);
            if (pacer?.stopped || clock() >= options.deadlineMs) {
                return {completed, deadlineReached: true};
            }
            let next = 0;
            let stopped = false;
            const results: R[] = [];
            async function worker(): Promise<void> {
                while (
                    !stopped &&
                    next < batch.length &&
                    clock() < options.deadlineMs
                ) {
                    const task = batch[next++];
                    active += 1;
                    Observability.setGauge('alert_sweep_active', active);
                    Observability.setGauge(
                        'alert_sweep_queue_size',
                        Math.max(0, tasks.length - completed - active)
                    );
                    try {
                        const result = await run(task);
                        results.push(result);
                        if (!completeBatch) {
                            completed += 1;
                            Observability.setGauge(
                                'alert_sweep_queue_size',
                                Math.max(0, tasks.length - completed - active)
                            );
                        }
                    } catch (error) {
                        stopped = true;
                        throw error;
                    } finally {
                        active -= 1;
                        Observability.setGauge('alert_sweep_active', active);
                        Observability.setGauge(
                            'alert_sweep_queue_size',
                            Math.max(0, tasks.length - completed - active)
                        );
                    }
                }
            }
            const settled = await Promise.allSettled(
                Array.from({length: Math.min(concurrency, batch.length)}, () =>
                    worker()
                )
            );
            if (completeBatch) {
                await completeBatch(results);
                completed += results.length;
                Observability.setGauge(
                    'alert_sweep_queue_size',
                    Math.max(0, tasks.length - completed)
                );
            }
            const failed = settled.find(
                (result) => result.status === 'rejected'
            );
            if (failed?.status === 'rejected') throw failed.reason;
        }
        return {completed, deadlineReached: completed < tasks.length};
    } finally {
        Observability.setGauge('alert_sweep_queue_size', 0);
        Observability.setGauge('alert_sweep_active', 0);
    }
}

function sweepOptions(tick: SweepTick) {
    return {
        concurrency: tuning.alert.sweepConcurrency,
        batchSize: tuning.alert.sweepBatchSize,
        deadlineMs: tick.deadlineMs,
        pacer: tick.pacer
    };
}

// Half the tick budget paces; the other half absorbs slow database work.
export function sweepSpreadMs(): number {
    return Math.floor(
        Math.min(
            tuning.alert.sweepIntervalSec * 1000,
            tuning.alert.sweepMaxDurationMs
        ) / 2
    );
}

interface PreparedSweepCleanup {
    prepared: PreparedAlertResolution;
    beforeCleanup?: PreparedAlertResolution;
    device: LogicalDeviceHint;
}

type SweepAlertResolver = ReturnType<typeof createSweepAlertResolver>;

async function completePreparedSweepResolutions(
    rule: LoadedAlertRule,
    cleanup: SweepAlertResolver,
    results: readonly (PreparedSweepCleanup | undefined)[]
): Promise<void> {
    await cleanup.dispatch();
    const pending = results.filter(
        (result): result is PreparedSweepCleanup => result !== undefined
    );
    const concurrency = Math.min(
        Math.max(1, Math.floor(tuning.alert.sweepConcurrency)),
        pending.length
    );
    let next = 0;
    let firstError: unknown;
    async function worker(): Promise<void> {
        while (next < pending.length) {
            const result = pending[next++];
            try {
                if (result.beforeCleanup) {
                    await cleanup.resolvePrepared(result.beforeCleanup);
                }
                await cleanup.resolvePrepared(result.prepared);
            } catch (err) {
                try {
                    cleanup.assertActive();
                    await markEvaluationState(
                        rule,
                        evaluationErrorMatch(
                            rule,
                            result.device.externalId,
                            err
                        ),
                        'evaluation_error',
                        false,
                        result.device
                    );
                    Observability.incrementCounter(
                        'alert_sweep_evaluation_errors'
                    );
                } catch (completionError) {
                    firstError ??= completionError;
                }
            }
        }
    }
    await Promise.all(Array.from({length: concurrency}, () => worker()));
    if (firstError !== undefined) throw firstError;
}

/** Whether this tick should do work: leader-owned, enabled, and not overlapping. */
export function shouldRunTick(state: {
    leader: boolean;
    enabled: boolean;
    inProgress: boolean;
}): boolean {
    return state.leader && state.enabled && !state.inProgress;
}

interface SweepOrgRow {
    organization_id: string;
}

// From the DB, not the engine's event-warmed cache — else a quiet org's
// deadman rule would never load.
export async function sweepOrgs(): Promise<string[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_sweep_orgs',
        {}
    );
    const rows = (result?.rows ?? []) as SweepOrgRow[];
    return rows.map((r) => r.organization_id);
}

// Last-changed per (rule, device, field). TTL outlasts the max window (24h).
const STUCK_CACHE_MAX = 50_000;
const STUCK_CACHE_TTL_MS = 25 * 60 * 60 * 1000;
const stuckSamples = new BoundedMap<string, {value: number; changedAt: number}>(
    {maxSize: STUCK_CACHE_MAX, ttlMs: STUCK_CACHE_TTL_MS}
);

// Resend guard: a still-true condition is re-upserted at most once per window,
// so a continuously-failing rule doesn't write an inbox row every tick.
const RESEND_DEFAULT_SEC = 300;
const lastFire = new BoundedMap<string, number>({
    maxSize: 100_000,
    ttlMs: STUCK_CACHE_TTL_MS
});

async function fireOnce(
    rule: LoadedAlertRule,
    match: MatchResult,
    now: number,
    device: LogicalDeviceHint
): Promise<void> {
    const canonical = await canonicalizeAlertMatch(
        rule.organizationId,
        rule.id,
        match,
        device
    );
    const windowSec =
        rule.dedupeWindowSec > 0 ? rule.dedupeWindowSec : RESEND_DEFAULT_SEC;
    const prev = lastFire.get(canonical.fingerprintV2);
    if (prev !== undefined && now - prev < windowSec * 1000) return;
    // Claim the fingerprint BEFORE the await, and give it back if the fire
    // throws. Stamping only afterwards let a transient failure suppress the
    // alert for windowSec, but the sweep runs several devices concurrently and
    // canonicalizeAlertMatch collapses a virtual device onto its source, so two
    // workers can reach the same fingerprint and both find it unclaimed.
    // Claim-then-release keeps the failure path open without that window.
    lastFire.set(canonical.fingerprintV2, now);
    try {
        await ingestSweepMatch(rule, canonical);
    } catch (error) {
        lastFire.delete(canonical.fingerprintV2);
        throw error;
    }
}

function deviceHint(device: AbstractDevice): LogicalDeviceHint {
    return {deviceId: device.id, externalId: device.shellyID};
}

function noDataMatch(
    rule: LoadedAlertRule,
    shellyID: string,
    context: Record<string, unknown>
): MatchResult {
    return {
        fingerprintV2: `rule:${rule.id}:device:${shellyID}:no_data`,
        title: `${shellyID} has no data`,
        message: `Rule "${rule.name}" could not evaluate because required data is missing.`,
        subject: {type: 'device', id: shellyID},
        context: {shellyID, ...context}
    };
}

function evaluationErrorMatch(
    rule: LoadedAlertRule,
    shellyID: string,
    err: unknown
): MatchResult {
    const message = err instanceof Error ? err.message : String(err);
    return {
        fingerprintV2: `rule:${rule.id}:device:${shellyID}:evaluation_error`,
        title: `${shellyID} alert evaluation error`,
        message: `Rule "${rule.name}" could not be evaluated.`,
        subject: {type: 'device', id: shellyID},
        context: {shellyID, error: message}
    };
}

interface StuckConfig {
    component: string;
    field: string;
    notChangedForSec: number;
}

function readStuckConfig(config: Record<string, unknown>): StuckConfig | null {
    const {component, field, notChangedForSec} = config;
    if (typeof component !== 'string' || typeof field !== 'string') return null;
    if (typeof notChangedForSec !== 'number') return null;
    return {component, field, notChangedForSec};
}

/** Memberships for a device, cached — so scoped sweep rules resolve correctly. */
async function subjectFor(
    device: AbstractDevice,
    organizationId: string,
    scope: ScopeSelector
) {
    return resolveSubjectForEvent(
        {
            kind: 'device_status_changed',
            organizationId,
            shellyID: device.shellyID,
            status: (device.status ?? {}) as Record<string, unknown>,
            device
        },
        PostgresProvider.callMethod,
        [scope]
    );
}

async function eligible(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    organizationId: string
): Promise<boolean> {
    if (!deviceSupportsKind(capabilityViewOf(device), rule.kind, rule.config))
        return false;
    const subject = await subjectFor(device, organizationId, rule.scope);
    return matchesScope(rule.scope, subject);
}

// Fires when a reading has not changed for notChangedForSec. The window is
// measured from when the sweep first saw the value.
async function evaluateStuck(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number
): Promise<void> {
    const cfg = readStuckConfig(rule.config);
    if (!cfg) return;
    const value = readNumber(
        device.status as Record<string, unknown>,
        `${cfg.component}.${cfg.field}`
    );
    if (value === null) return;
    const key = ruleFieldKey(
        rule.id,
        String(device.id),
        cfg.component,
        cfg.field
    );
    const prior = stuckSamples.get(key);
    if (!prior || prior.value !== value) {
        const cleared = prior !== undefined && prior.value !== value;
        stuckSamples.set(key, {value, changedAt: now});
        // Sweep owns the clear; a changed reading resolves the stuck alert.
        if (cleared && rule.autoResolve) {
            await resolveFingerprint(
                rule,
                synthesizeStuckSensorMiss({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    shellyID: device.shellyID,
                    component: cfg.component,
                    field: cfg.field,
                    notChangedForSec: cfg.notChangedForSec
                }).fingerprintV2,
                deviceHint(device)
            );
        }
        return;
    }
    if (!stuckFor(prior.changedAt, now, cfg.notChangedForSec)) return;
    await fireOnce(
        rule,
        synthesizeStuckSensorMiss({
            ruleId: rule.id,
            ruleName: rule.name,
            shellyID: device.shellyID,
            component: cfg.component,
            field: cfg.field,
            notChangedForSec: cfg.notChangedForSec
        }),
        now,
        deviceHint(device)
    );
}

// Capped value history per (rule, device, field). Rate is measured against a
// sample ~windowSec old, so it is independent of the tick interval.
const RATE_HISTORY_MAX = 64;
const rateHistory = new BoundedMap<string, Sample[]>({
    maxSize: 20_000,
    ttlMs: STUCK_CACHE_TTL_MS
});

interface RateConfig {
    component: string;
    field: string;
    deltaValue: number;
    windowSec: number;
}

type ThresholdOperator = 'gt' | 'gte' | 'lt' | 'lte';

interface EnergyConsumptionConfig {
    windowSec: number;
    operator: ThresholdOperator;
    thresholdKWh: number;
    clearThresholdKWh?: number;
    minSamples?: number;
}

function isThresholdOperator(v: unknown): v is ThresholdOperator {
    return v === 'gt' || v === 'gte' || v === 'lt' || v === 'lte';
}

function readEnergyConsumptionConfig(
    config: Record<string, unknown>
): EnergyConsumptionConfig | null {
    const {windowSec, operator, thresholdKWh, clearThresholdKWh, minSamples} =
        config;
    if (typeof windowSec !== 'number') return null;
    if (!isThresholdOperator(operator)) return null;
    if (typeof thresholdKWh !== 'number') return null;
    return {
        windowSec,
        operator,
        thresholdKWh,
        clearThresholdKWh:
            typeof clearThresholdKWh === 'number'
                ? clearThresholdKWh
                : undefined,
        minSamples: typeof minSamples === 'number' ? minSamples : undefined
    };
}

function thresholdMatches(
    operator: ThresholdOperator,
    current: number,
    threshold: number
): boolean {
    switch (operator) {
        case 'gt':
            return current > threshold;
        case 'gte':
            return current >= threshold;
        case 'lt':
            return current < threshold;
        case 'lte':
            return current <= threshold;
    }
}

const attributeWindowRepo = createAttributeWindowRepo();

async function readConsumptionWindowKWh(
    organizationId: string,
    shellyID: string,
    from: Date,
    to: Date
): Promise<{consumptionKWh: number; sampleCount: number} | null> {
    return (
        (
            await readConsumptionWindowsKWh(
                organizationId,
                [shellyID],
                from,
                to
            )
        ).get(shellyID) ?? null
    );
}

async function readConsumptionWindowsKWh(
    organizationId: string,
    shellyIDs: readonly string[],
    from: Date,
    to: Date
): Promise<Map<string, {consumptionKWh: number; sampleCount: number}>> {
    if (shellyIDs.length === 0) return new Map();
    const bucket = pickAggregateBucket(to.getTime() - from.getTime());
    const rows = await attributeWindowRepo.queryContributors({
        shellyIDs: [
            ...new Set(shellyIDs.filter((id) => !id.startsWith('vdev_')))
        ],
        from,
        to,
        bucket,
        metric: 'consumption',
        aggregation: 'sum'
    });
    const out = new Map<
        string,
        {consumptionKWh: number; sampleCount: number}
    >();
    for (const row of rows) {
        out.set(row.shellyID, {
            consumptionKWh: row.value,
            sampleCount: row.sampleCount
        });
    }
    for (const [externalId, reading] of await readVirtualConsumptionWindowsKWh(
        organizationId,
        shellyIDs,
        from,
        to,
        bucket
    )) {
        out.set(externalId, reading);
    }
    return out;
}

async function evaluateEnergyConsumption(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number,
    preloadedReading?: {consumptionKWh: number; sampleCount: number} | null
): Promise<void> {
    const cfg = readEnergyConsumptionConfig(rule.config);
    if (!cfg) return;
    const to = new Date(now);
    const from = new Date(now - cfg.windowSec * 1000);
    const reading =
        preloadedReading === undefined
            ? await readConsumptionWindowKWh(
                  rule.organizationId,
                  device.shellyID,
                  from,
                  to
              )
            : preloadedReading;
    if (!reading) {
        await markEvaluationState(
            rule,
            noDataMatch(rule, device.shellyID, {
                reason: 'missing_consumption_window',
                windowSec: cfg.windowSec
            }),
            'no_data',
            false,
            deviceHint(device)
        );
        return;
    }
    if (cfg.minSamples !== undefined && reading.sampleCount < cfg.minSamples) {
        await markEvaluationState(
            rule,
            noDataMatch(rule, device.shellyID, {
                reason: 'insufficient_samples',
                windowSec: cfg.windowSec,
                sampleCount: reading.sampleCount,
                minSamples: cfg.minSamples
            }),
            'no_data',
            false,
            deviceHint(device)
        );
        return;
    }
    await resolveFingerprint(
        rule,
        noDataMatch(rule, device.shellyID, {}).fingerprintV2,
        deviceHint(device)
    );
    const fp = `rule:${rule.id}:device:${device.shellyID}`;
    const fireMatches = thresholdMatches(
        cfg.operator,
        reading.consumptionKWh,
        cfg.thresholdKWh
    );
    const clearThreshold = cfg.clearThresholdKWh ?? cfg.thresholdKWh;
    const clearStillMatches = thresholdMatches(
        cfg.operator,
        reading.consumptionKWh,
        clearThreshold
    );
    if (!clearStillMatches) {
        if (rule.autoResolve) {
            await resolveFingerprint(rule, fp, deviceHint(device));
        }
        return;
    }
    if (!fireMatches) return;
    await fireOnce(
        rule,
        synthesizeEnergyConsumptionThreshold({
            ruleId: rule.id,
            ruleName: rule.name,
            shellyID: device.shellyID,
            consumptionKWh: reading.consumptionKWh,
            thresholdKWh: cfg.thresholdKWh,
            operator: cfg.operator,
            windowSec: cfg.windowSec,
            sampleCount: reading.sampleCount
        }),
        now,
        deviceHint(device)
    );
}

function readRateConfig(config: Record<string, unknown>): RateConfig | null {
    const {component, field, deltaValue, windowSec} = config;
    if (typeof component !== 'string' || typeof field !== 'string') return null;
    if (typeof deltaValue !== 'number' || typeof windowSec !== 'number') {
        return null;
    }
    return {component, field, deltaValue, windowSec};
}

// Fires when the per-second rate over ~windowSec exceeds deltaValue, either way.
async function evaluateRate(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number
): Promise<void> {
    const cfg = readRateConfig(rule.config);
    if (!cfg) return;
    const value = readNumber(
        device.status as Record<string, unknown>,
        `${cfg.component}.${cfg.field}`
    );
    if (value === null) return;
    const key = ruleFieldKey(
        rule.id,
        String(device.id),
        cfg.component,
        cfg.field
    );
    const history = [...(rateHistory.get(key) ?? []), {value, ts: now}].slice(
        -RATE_HISTORY_MAX
    );
    rateHistory.set(key, history);
    const anchor = sampleAtOrBefore(history, now - cfg.windowSec * 1000);
    if (!anchor) return;
    const rate = computeRate(anchor, {value, ts: now});
    if (rate === null) return;
    const match = synthesizeRateOfChangeMiss({
        ruleId: rule.id,
        ruleName: rule.name,
        shellyID: device.shellyID,
        component: cfg.component,
        field: cfg.field,
        rate,
        deltaValue: cfg.deltaValue,
        windowSec: cfg.windowSec
    });
    // Sweep owns the clear (no event-driven clear); resolve when the rate
    // falls back within delta, else it stays active forever.
    if (Math.abs(rate) < cfg.deltaValue) {
        if (rule.autoResolve) {
            await resolveFingerprint(
                rule,
                match.fingerprintV2,
                deviceHint(device)
            );
        }
        return;
    }
    await fireOnce(rule, match, now, deviceHint(device));
}

// A sleeping device reports on its wakeup_period; judge against that so a
// normal sleep is not read as a miss.
function effectiveInterval(device: AbstractDevice, configSec: number): number {
    if (!device.profile.flags.isBattery) return configSec;
    const wakeup = readNumber(
        device.status as Record<string, unknown>,
        'sys.wakeup_period'
    );
    return wakeup !== null ? Math.max(configSec, wakeup) : configSec;
}

// Fires when an online device has stopped reporting. Transport-down is
// device_offline's job (also for a BLU child hanging off this device), so
// heartbeat only watches connected-but-silent.
async function evaluateHeartbeat(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number
): Promise<void> {
    const configSec = rule.config.expectedIntervalSec;
    if (typeof configSec !== 'number') return;
    if (device.presence !== 'online') return;
    const interval = effectiveInterval(device, configSec);
    const grace = tuning.alert.sweepEvalDelaySec;
    if (!heartbeatMissed(device.lastReportTs, now, interval, grace)) return;
    await fireOnce(
        rule,
        synthesizeHeartbeatMiss({
            ruleId: rule.id,
            ruleName: rule.name,
            shellyID: device.shellyID,
            expectedIntervalSec: interval
        }),
        now,
        deviceHint(device)
    );
}

// One device of a batched sweep: evaluate, then hand the error fingerprint to the batch cleanup.
async function evaluatePreparedDevice(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    cleanup: SweepAlertResolver,
    evaluate: () => Promise<string | undefined>
): Promise<PreparedSweepCleanup | undefined> {
    try {
        const beforeCleanupFingerprint = await evaluate();
        const beforeCleanup = beforeCleanupFingerprint
            ? await cleanup.prepare(
                  beforeCleanupFingerprint,
                  deviceHint(device)
              )
            : undefined;
        const prepared = await cleanup.prepare(
            evaluationErrorMatch(rule, device.shellyID, '').fingerprintV2,
            deviceHint(device)
        );
        return {
            prepared,
            beforeCleanup,
            device: deviceHint(device)
        } satisfies PreparedSweepCleanup;
    } catch (err) {
        cleanup.assertActive();
        await markEvaluationState(
            rule,
            evaluationErrorMatch(rule, device.shellyID, err),
            'evaluation_error',
            false,
            deviceHint(device)
        );
        Observability.incrementCounter('alert_sweep_evaluation_errors');
        return undefined;
    } finally {
        Observability.incrementCounter('alert_sweep_evaluated');
    }
}

// A batch-level query failed before any device could be evaluated: mark every device errored without aborting the tick.
function markBatchQueryFailure(
    rule: LoadedAlertRule,
    devices: readonly AbstractDevice[],
    err: unknown,
    tick: SweepTick
): Promise<BoundedSweepResult> {
    return runBoundedSweep(
        devices,
        async (device) => {
            await markEvaluationState(
                rule,
                evaluationErrorMatch(rule, device.shellyID, err),
                'evaluation_error',
                false,
                deviceHint(device)
            );
            Observability.incrementCounter('alert_sweep_evaluation_errors');
        },
        sweepOptions(tick)
    );
}

async function evaluateEnergyConsumptionBatch(
    rule: LoadedAlertRule,
    devices: readonly AbstractDevice[],
    tick: SweepTick,
    cleanup: SweepAlertResolver
): Promise<BoundedSweepResult> {
    const cfg = readEnergyConsumptionConfig(rule.config);
    if (!cfg) return {completed: 0, deadlineReached: false};
    const now = tick.now();
    const to = new Date(now);
    const from = new Date(now - cfg.windowSec * 1000);
    let readings: Map<string, {consumptionKWh: number; sampleCount: number}>;
    try {
        readings = await readConsumptionWindowsKWh(
            rule.organizationId,
            devices.map((d) => d.shellyID),
            from,
            to
        );
    } catch (err) {
        // Isolate a batch-query failure so it doesn't abort the whole tick.
        return markBatchQueryFailure(rule, devices, err, tick);
    }
    return runBoundedSweep(
        devices,
        (device) =>
            evaluatePreparedDevice(rule, device, cleanup, async () => {
                await evaluateEnergyConsumption(
                    rule,
                    device,
                    now,
                    readings.get(device.shellyID) ?? null
                );
                return undefined;
            }),
        sweepOptions(tick),
        (results) => completePreparedSweepResolutions(rule, cleanup, results)
    );
}

const EXPIRING_PAGE = 500;
const EXPIRING_DEFAULT_DAYS = 30;
const DAY_MS = 86_400_000;

interface CredentialExpiringDeps {
    listExpiring: typeof listExpiringCredentials;
    fire: typeof fireOnce;
}

const CREDENTIAL_EXPIRING_DEPS: CredentialExpiringDeps = {
    listExpiring: listExpiringCredentials,
    fire: fireOnce
};

// One credential query per rule per tick, then one decision per device.
async function loadExpiringByExternalId(
    organizationId: string,
    withinDays: number,
    deps: CredentialExpiringDeps
): Promise<Map<string, string>> {
    const byExternalId = new Map<string, string>();
    let offset = 0;
    for (;;) {
        const page = await deps.listExpiring({
            organizationId,
            withinDays,
            limit: EXPIRING_PAGE,
            offset
        });
        for (const item of page.items) {
            if (!item.expectedExternalId || !item.notAfter) continue;
            const known = byExternalId.get(item.expectedExternalId);
            // Two active keys on one device: warn on the one ending first.
            if (known && Date.parse(known) <= Date.parse(item.notAfter))
                continue;
            byExternalId.set(item.expectedExternalId, item.notAfter);
        }
        offset += page.items.length;
        if (page.items.length === 0 || offset >= page.total) {
            return byExternalId;
        }
    }
}

function daysUntil(endsAt: string, now: number): number {
    return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / DAY_MS));
}

export async function evaluateCredentialExpiringBatch(
    rule: LoadedAlertRule,
    devices: readonly AbstractDevice[],
    tick: SweepTick,
    cleanup: SweepAlertResolver,
    deps: CredentialExpiringDeps = CREDENTIAL_EXPIRING_DEPS
): Promise<BoundedSweepResult> {
    // No device in scope, so the credential query would answer nobody.
    if (devices.length === 0) return {completed: 0, deadlineReached: false};
    const withinDays =
        typeof rule.config.daysBefore === 'number'
            ? rule.config.daysBefore
            : EXPIRING_DEFAULT_DAYS;
    let expiring: Map<string, string>;
    try {
        expiring = await loadExpiringByExternalId(
            rule.organizationId,
            withinDays,
            deps
        );
    } catch (err) {
        // Isolate a batch-query failure so it doesn't abort the whole tick.
        return markBatchQueryFailure(rule, devices, err, tick);
    }
    const now = tick.now();
    return runBoundedSweep(
        devices,
        (device) =>
            evaluatePreparedDevice(rule, device, cleanup, async () => {
                const endsAt = expiring.get(device.shellyID);
                if (endsAt) {
                    await deps.fire(
                        rule,
                        synthesizeCredentialExpiring({
                            ruleId: rule.id,
                            ruleName: rule.name,
                            shellyID: device.shellyID,
                            deviceName: device.info?.name ?? undefined,
                            endsAt,
                            daysLeft: daysUntil(endsAt, now)
                        }),
                        now,
                        deviceHint(device)
                    );
                    return undefined;
                }
                // Batched with the evaluation-error clear below: one DB
                // read/write per tick instead of one per device.
                return credentialExpiringFingerprint(rule.id, device.shellyID);
            }),
        sweepOptions(tick),
        (results) => completePreparedSweepResolutions(rule, cleanup, results)
    );
}

const TICK_KINDS: ReadonlySet<AlertRuleKind> = new Set([
    'device_offline',
    'stuck_sensor',
    'rate_of_change',
    'heartbeat',
    'energy_consumption_threshold',
    'cost_budget_threshold',
    'record_incomplete',
    'approaching_new_peak',
    'credential_expiring'
]);

async function evaluateRecordIncomplete(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number
): Promise<void> {
    const config = recordIncompleteConfig(rule.config);
    if (!config) return;
    const fingerprint = `rule:${rule.id}:device:${device.shellyID}`;
    if (!isPastRecordDeadline(new Date(now), config)) {
        if (rule.autoResolve)
            await resolveFingerprint(rule, fingerprint, deviceHint(device));
        return;
    }
    const latest = await latestRoleReadingAt(
        rule.organizationId,
        device.shellyID,
        config.roleKey,
        new Date(now)
    );
    if (readingIsFromLocalToday(latest, new Date(now), config.timeZone)) {
        if (rule.autoResolve)
            await resolveFingerprint(rule, fingerprint, deviceHint(device));
        return;
    }
    await fireOnce(
        rule,
        recordIncompleteMatch(rule, device, config, latest),
        now,
        deviceHint(device)
    );
}

async function evaluateApproachingNewPeak(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number
): Promise<void> {
    const config = approachingNewPeakConfig(rule.config);
    if (!config) return;
    const comparison = await readDemandPeakComparison(
        rule.organizationId,
        device.id,
        new Date(now),
        config
    );
    const fingerprint = `rule:${rule.id}:device:${device.shellyID}`;
    if (!comparison) {
        await markEvaluationState(
            rule,
            noDataMatch(rule, device.shellyID, {
                reason: 'missing_demand_comparison'
            }),
            'no_data',
            false,
            deviceHint(device)
        );
        return;
    }
    await resolveFingerprint(
        rule,
        noDataMatch(rule, device.shellyID, {}).fingerprintV2,
        deviceHint(device)
    );
    const ratio = comparison.currentKw / comparison.baselineKw;
    if (ratio < config.clearRatio) {
        if (rule.autoResolve)
            await resolveFingerprint(rule, fingerprint, deviceHint(device));
        return;
    }
    if (ratio < config.warningRatio) return;
    await fireOnce(
        rule,
        approachingNewPeakMatch(rule, device, config, comparison),
        now,
        deviceHint(device)
    );
}

async function evaluateCostBudgetThreshold(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number
): Promise<void> {
    const config = costBudgetConfig(rule.config);
    if (!config) return;
    const spend = await readActualCostBudgetSpend(
        rule.organizationId,
        device,
        new Date(now),
        config
    );
    if (!spend) {
        await markEvaluationState(
            rule,
            noDataMatch(rule, device.shellyID, {
                reason: 'unpriced_or_incomplete_energy_cost',
                costBasis: 'recorded_import_energy_charge'
            }),
            'no_data',
            false,
            deviceHint(device)
        );
        return;
    }
    await resolveFingerprint(
        rule,
        noDataMatch(rule, device.shellyID, {}).fingerprintV2,
        deviceHint(device)
    );

    for (const threshold of crossedCostBudgetThresholds(
        spend.actualCost,
        config
    )) {
        const claim = {
            organizationId: rule.organizationId,
            ruleId: rule.id,
            periodStart: spend.period.from,
            thresholdBps: threshold.thresholdBps
        };
        const claimed = await claimCostBudgetThreshold({
            ...claim,
            actualCost: spend.actualCost,
            budgetAmount: config.budgetAmount,
            currency: spend.currency
        });
        if (!claimed) continue;
        try {
            await fireOnce(
                rule,
                costBudgetThresholdMatch(
                    rule,
                    device,
                    config,
                    spend,
                    threshold
                ),
                now,
                deviceHint(device)
            );
        } catch (error) {
            await releaseCostBudgetThresholdClaim(claim);
            throw error;
        }
    }
}

async function evaluateDeviceOffline(
    rule: LoadedAlertRule,
    row: StoredPresenceRow,
    organizationId: string,
    now: number,
    bluetooth: ReadonlyMap<string, BluetoothDeviceDto>,
    cleanup: SweepAlertResolver
): Promise<PreparedAlertResolution | undefined> {
    const shellyID = row.external_id;
    const hint = {deviceId: row.id, externalId: shellyID};
    const live = DeviceCollector.getDevice(shellyID);
    const name = row.name ?? (live?.info?.name as string | undefined);
    const match = (context: Record<string, unknown> = {}) =>
        buildDeviceOfflineMatch(rule.id, rule.name, shellyID, name, context);
    const offlineForSec = offlineForSecOf(rule);
    const reach = deviceReachability({
        row,
        live,
        bluetooth: bluetooth.get(shellyID),
        collector: DeviceCollector,
        offlineForSec,
        now
    });

    if (reach.state === 'online') {
        if (rule.autoResolve) {
            return cleanup.prepare(match().fingerprintV2, hint);
        }
        return undefined;
    }

    const subject = await resolveSubjectForEvent(
        {kind: 'device_offline', organizationId, shellyID, device: live},
        PostgresProvider.callMethod,
        [rule.scope]
    );
    if (!matchesScope(rule.scope, subject)) return undefined;

    if (reach.state === 'unknown') {
        await markEvaluationState(
            rule,
            match({reason: reach.reason, source: 'presence_store'}),
            'no_data',
            false,
            hint
        );
        Observability.incrementCounter('alert_offline_no_last_seen');
        return undefined;
    }

    const offlineSince = new Date(reach.lastSeenMs).toISOString();
    if (reach.state === 'silent') {
        await markEvaluationState(
            rule,
            match({
                offlineForSec: offlineForSec ?? undefined,
                offlineSince,
                pendingReason: reach.reason,
                // remainingSec is not stored: it is stale the moment it is
                // written. rulePreview.ts recomputes it at request time.
                source: 'presence_store'
            }),
            'pending',
            false,
            hint
        );
        await OutboxWorker.enqueueOfflineFire(
            {organizationId, ruleId: rule.id, deviceId: row.id},
            new Date(reach.dueAtMs)
        );
        Observability.incrementCounter('alert_offline_pending_scheduled');
        return undefined;
    }

    await fireOnce(
        rule,
        match({
            offlineForSec: offlineForSec ?? undefined,
            offlineSince,
            reason: reach.reason,
            source: 'presence_store'
        }),
        now,
        hint
    );
    return undefined;
}

async function evaluateRule(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number
): Promise<void> {
    if (rule.kind === 'stuck_sensor') return evaluateStuck(rule, device, now);
    if (rule.kind === 'rate_of_change') return evaluateRate(rule, device, now);
    if (rule.kind === 'heartbeat') return evaluateHeartbeat(rule, device, now);
    if (rule.kind === 'energy_consumption_threshold') {
        return evaluateEnergyConsumption(rule, device, now);
    }
    if (rule.kind === 'cost_budget_threshold') {
        return evaluateCostBudgetThreshold(rule, device, now);
    }
    if (rule.kind === 'record_incomplete') {
        return evaluateRecordIncomplete(rule, device, now);
    }
    if (rule.kind === 'approaching_new_peak') {
        return evaluateApproachingNewPeak(rule, device, now);
    }
}

// The rule watches one gateway component that a BLU row now owns.
function readingPromotedAway(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    promoted: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
    const component = rule.config.component;
    if (typeof component !== 'string') return false;
    return promoted.get(device.shellyID)?.has(component) ?? false;
}

// One tick: evaluate every enabled time/absence rule against its scoped,
// capable devices. Without a tick, `now` is the fixed evaluation time.
export async function runSweepForRules(
    organizationId: string,
    now: number,
    ruleIds?: readonly number[],
    tick = new SweepTick({
        now,
        deadlineMs: now + tuning.alert.sweepMaxDurationMs
    })
): Promise<void> {
    const only = ruleIds ? new Set(ruleIds) : null;
    const rules = (await sweepRulesFor(organizationId)).filter(
        (r) => TICK_KINDS.has(r.kind) && (!only || only.has(r.id))
    );
    if (rules.length === 0) return;

    const devices = DeviceCollector.getAll().filter(
        (d) => getDeviceOrg(d.shellyID) === organizationId
    );
    const needsStoredPresence = rules.some(
        (r) => r.kind === 'device_offline' || r.kind === 'heartbeat'
    );
    const storedPresence = needsStoredPresence
        ? await storedDevicePresence(organizationId)
        : [];
    const bluetooth = rules.some((r) => r.kind === 'device_offline')
        ? await bluetoothDevicesForPresence(organizationId, storedPresence)
        : new Map<string, BluetoothDeviceDto>();
    tick.noteRowsRead(storedPresence.length + bluetooth.size);
    // A reading a BLU row took over from its gateway is judged on the BLU row
    // only, so one silence or one stuck value never fires twice.
    const promoted = new Map<string, Set<string>>();
    if (rules.some((rule) => rule.kind !== 'device_offline')) {
        const seen = new Set(devices.map((device) => device.shellyID));
        const presenceByExternalId = new Map(
            storedPresence.map((row) => [row.external_id, row])
        );
        const storedRows = await storedDeviceSnapshots(organizationId);
        tick.noteRowsRead(storedRows.length);
        for (const [gateway, keys] of promotedComponentsByGateway(storedRows))
            promoted.set(gateway, keys);
        for (const row of storedRows) {
            const projected =
                row.external_id.startsWith('vdev_') ||
                row.kind === BLUETOOTH_KIND;
            if (!projected || seen.has(row.external_id)) continue;
            const snapshot = deviceSnapshotFromStoredRow(row);
            const presence = presenceByExternalId.get(row.external_id);
            devices.push({
                ...snapshot,
                ...(presence?.last_seen
                    ? {lastReportTs: new Date(presence.last_seen).getTime()}
                    : {})
            } as AbstractDevice);
            seen.add(row.external_id);
        }
    }

    for (const rule of rules) {
        const previousCompletion = lastRuleCompletedAt.get(rule.id);
        Observability.setLabeledGauge(
            'alert_rule_evaluation_wait_seconds',
            {rule_id: String(rule.id)},
            previousCompletion === undefined
                ? 0
                : Math.max(0, (tick.now() - previousCompletion) / 1000)
        );
        if (tick.expired()) {
            Observability.incrementCounter('alert_sweep_budget_exhausted');
            break;
        }
        const cleanup = createSweepAlertResolver(rule, {deferReads: true});
        try {
            if (rule.kind === 'device_offline') {
                const outcome = await runBoundedSweep(
                    storedPresence,
                    async (row) => {
                        try {
                            const beforeCleanup = await evaluateDeviceOffline(
                                rule,
                                row,
                                organizationId,
                                tick.now(),
                                bluetooth,
                                cleanup
                            );
                            const prepared = await cleanup.prepare(
                                evaluationErrorMatch(rule, row.external_id, '')
                                    .fingerprintV2,
                                {deviceId: row.id, externalId: row.external_id}
                            );
                            return {
                                prepared,
                                beforeCleanup,
                                device: {
                                    deviceId: row.id,
                                    externalId: row.external_id
                                }
                            } satisfies PreparedSweepCleanup;
                        } catch (err) {
                            cleanup.assertActive();
                            await markEvaluationState(
                                rule,
                                evaluationErrorMatch(
                                    rule,
                                    row.external_id,
                                    err
                                ),
                                'evaluation_error',
                                false,
                                {deviceId: row.id, externalId: row.external_id}
                            );
                            Observability.incrementCounter(
                                'alert_sweep_evaluation_errors'
                            );
                        } finally {
                            Observability.incrementCounter(
                                'alert_sweep_evaluated'
                            );
                        }
                        return undefined;
                    },
                    sweepOptions(tick),
                    (results) =>
                        completePreparedSweepResolutions(rule, cleanup, results)
                );
                if (outcome.deadlineReached) {
                    Observability.incrementCounter(
                        'alert_sweep_budget_exhausted'
                    );
                    break;
                }
                lastRuleCompletedAt.set(rule.id, Date.now());
                continue;
            }
            // Batch kinds: eligibility first, then one query for the rule.
            if (
                rule.kind === 'energy_consumption_threshold' ||
                rule.kind === 'credential_expiring'
            ) {
                const eligibleDevices: AbstractDevice[] = [];
                const outcome = await runBoundedSweep(
                    devices,
                    async (device) => {
                        try {
                            if (await eligible(rule, device, organizationId)) {
                                eligibleDevices.push(device);
                            }
                        } catch (err) {
                            cleanup.assertActive();
                            await markEvaluationState(
                                rule,
                                evaluationErrorMatch(
                                    rule,
                                    device.shellyID,
                                    err
                                ),
                                'evaluation_error',
                                false,
                                deviceHint(device)
                            );
                            Observability.incrementCounter(
                                'alert_sweep_evaluation_errors'
                            );
                        }
                    },
                    sweepOptions(tick)
                );
                if (outcome.deadlineReached) {
                    Observability.incrementCounter(
                        'alert_sweep_budget_exhausted'
                    );
                    break;
                }
                const evaluation =
                    rule.kind === 'energy_consumption_threshold'
                        ? await evaluateEnergyConsumptionBatch(
                              rule,
                              eligibleDevices,
                              tick,
                              cleanup
                          )
                        : await evaluateCredentialExpiringBatch(
                              rule,
                              eligibleDevices,
                              tick,
                              cleanup
                          );
                if (evaluation.deadlineReached) {
                    Observability.incrementCounter(
                        'alert_sweep_budget_exhausted'
                    );
                    break;
                }
                lastRuleCompletedAt.set(rule.id, Date.now());
                continue;
            }
            const ruleDevices =
                rule.kind === 'cost_budget_threshold'
                    ? (() => {
                          const selected = selectCostBudgetTargetDevice(
                              rule.scope,
                              devices
                          );
                          if (selected === null) {
                              logger.error(
                                  'cost budget rule %s has invalid non-device scope; refusing evaluation',
                                  rule.id
                              );
                              Observability.incrementCounter(
                                  'alert_sweep_evaluation_errors'
                              );
                              return [];
                          }
                          return selected;
                      })()
                    : devices;
            const outcome = await runBoundedSweep(
                ruleDevices,
                async (device) => {
                    let evaluated = false;
                    try {
                        if (readingPromotedAway(rule, device, promoted)) return;
                        if (!(await eligible(rule, device, organizationId)))
                            return;
                        evaluated = true;
                        await evaluateRule(rule, device, tick.now());
                        const prepared = await cleanup.prepare(
                            evaluationErrorMatch(rule, device.shellyID, '')
                                .fingerprintV2,
                            deviceHint(device)
                        );
                        return {
                            prepared,
                            device: deviceHint(device)
                        } satisfies PreparedSweepCleanup;
                    } catch (err) {
                        evaluated = true;
                        cleanup.assertActive();
                        await markEvaluationState(
                            rule,
                            evaluationErrorMatch(rule, device.shellyID, err),
                            'evaluation_error',
                            false,
                            deviceHint(device)
                        );
                        Observability.incrementCounter(
                            'alert_sweep_evaluation_errors'
                        );
                    } finally {
                        if (evaluated)
                            Observability.incrementCounter(
                                'alert_sweep_evaluated'
                            );
                    }
                    return undefined;
                },
                sweepOptions(tick),
                (results) =>
                    completePreparedSweepResolutions(rule, cleanup, results)
            );
            if (outcome.deadlineReached) {
                Observability.incrementCounter('alert_sweep_budget_exhausted');
                break;
            }
            lastRuleCompletedAt.set(rule.id, Date.now());
        } finally {
            cleanup.close();
        }
    }
}

export async function runSweepTick(
    now: number,
    tick = new SweepTick({
        now,
        deadlineMs: Date.now() + tuning.alert.sweepMaxDurationMs
    })
): Promise<void> {
    const startedAt = Date.now();
    const {calls} = await countDbCalls(() =>
        runAsDbWorkload('alert', () => sweepEveryOrg(tick))
    );
    Observability.setGauge(
        'alert_sweep_duration_seconds',
        (Date.now() - startedAt) / 1000
    );
    Observability.setGauge('alert_sweep_db_calls', calls);
    Observability.setGauge('alert_sweep_rows_read', tick.rowsRead);
    Observability.setGauge('alert_sweep_units', tick.pacer.admittedUnits);
    Observability.setGauge(
        'alert_sweep_pace_wait_seconds',
        tick.pacer.waitedMs / 1000
    );
    Observability.incrementCounter('alert_sweep_ticks');
}

async function sweepEveryOrg(tick: SweepTick): Promise<void> {
    const orgs = await sweepOrgs();
    for (const organizationId of orgs) {
        if (tick.expired()) {
            Observability.incrementCounter('alert_sweep_budget_exhausted');
            break;
        }
        await sweepOrg(organizationId, tick);
    }
}

// A rule edit during a paced tick fails one org; the others still run.
async function sweepOrg(
    organizationId: string,
    tick: SweepTick
): Promise<void> {
    try {
        await runSweepForRules(organizationId, tick.now(), undefined, tick);
    } catch (err) {
        Observability.incrementCounter('alert_sweep_org_failures');
        logger.error(
            'alert sweep failed for org %s: %s',
            organizationId,
            String(err)
        );
    }
}

// Spreads the scheduled tick over its window at the size of the last tick.
async function runScheduledTick(): Promise<void> {
    const startedAt = Date.now();
    const tick = new SweepTick({
        now: startedAt,
        deadlineMs: startedAt + tuning.alert.sweepMaxDurationMs,
        pace: {windowMs: sweepSpreadMs(), expectedUnits: lastTickUnits}
    });
    runningTick = tick;
    try {
        await runSweepTick(startedAt, tick);
        if (!tick.pacer.stopped) lastTickUnits = tick.pacer.admittedUnits;
    } finally {
        runningTick = null;
    }
}

async function onInterval(): Promise<void> {
    if (
        !shouldRunTick({
            leader: isLeader(LEADER_NAME),
            enabled: tuning.alert.sweepEnabled,
            inProgress: tickInProgress
        })
    ) {
        return;
    }
    tickInProgress = true;
    try {
        await runScheduledTick();
    } catch (err) {
        logger.error('alert sweep tick failed: %s', err);
    } finally {
        tickInProgress = false;
    }
}

export function startScheduler(): void {
    if (started) return;
    started = true;
    lastTickUnits = 0;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(
        () => void onInterval(),
        tuning.alert.sweepIntervalSec * 1000
    );
    timer.unref?.();
    logger.info(
        'alert sweep started (interval=%ds, spread=%dms)',
        tuning.alert.sweepIntervalSec,
        sweepSpreadMs()
    );
    void onInterval();
}

export function stopScheduler(): void {
    if (!started) return;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    runningTick?.stop();
    started = false;
    logger.info('alert sweep stopped');
}

export function isSchedulerRunning(): boolean {
    return started;
}
