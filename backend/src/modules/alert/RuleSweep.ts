// RuleSweep — periodic, leader-gated evaluation of time/absence kinds
// (heartbeat, rate_of_change, stuck_sensor) that no device event can trigger.
// Reads in-memory devices, fires synthetic matches through the engine.
// Plan: docs/plans/2026-06-30-alert-periodic-sweep.md.
import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import type AbstractDevice from '../../model/AbstractDevice';
import {createAttributeWindowRepo} from '../../model/analytics/attributeWindowRepo';
import {pickAggregateBucket} from '../../model/analytics/bucketPick';
import type {AlertRuleKind} from '../../types/api/alert';
import {
    ingestSweepMatch,
    markEvaluationState,
    offlineForSecOf,
    resolveFingerprint,
    sweepRulesFor
} from '../AlertEngine';
import {BoundedMap} from '../boundedMap';
import * as DeviceCollector from '../DeviceCollector';
import * as OutboxWorker from '../delivery/OutboxWorker';
import {getDeviceOrg} from '../EventDistributor';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {capabilityViewOf, deviceSupportsKind} from './deviceCapability';
import {buildDeviceOfflineMatch} from './evaluators/deviceOffline';
import {synthesizeEnergyConsumptionThreshold} from './evaluators/energyConsumptionThreshold';
import {
    bluHeartbeatInterval,
    bluLivenessTargets,
    synthesizeHeartbeatMiss
} from './evaluators/heartbeat';
import {synthesizeRateOfChangeMiss} from './evaluators/rateOfChange';
import {ruleFieldKey} from './evaluators/ruleFieldCache';
import {readNumber} from './evaluators/shared';
import {synthesizeStuckSensorMiss} from './evaluators/stuckSensor';
import {matchesScope} from './scope';
import {
    type StoredPresenceRow,
    storedDevicePresence,
    timestampMs
} from './storedPresence';
import {resolveSubjectForEvent} from './subjectForEvent';
import {
    computeRate,
    heartbeatMissed,
    type Sample,
    sampleAtOrBefore,
    stuckFor
} from './sweepSampling';
import type {LoadedAlertRule, MatchResult} from './types';

const logger = log4js.getLogger('RuleSweep');
const LEADER_NAME = 'alert-sweep';

/** Kinds whose trigger is time/absence-based, so only the sweep can fire them. */
export const SWEEP_KINDS: readonly AlertRuleKind[] = [
    'device_offline',
    'heartbeat',
    'energy_consumption_threshold',
    'rate_of_change',
    'stuck_sensor'
];

let timer: NodeJS.Timeout | null = null;
let started = false;
let tickInProgress = false;

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
    now: number
): Promise<void> {
    const windowSec =
        rule.dedupeWindowSec > 0 ? rule.dedupeWindowSec : RESEND_DEFAULT_SEC;
    const prev = lastFire.get(match.fingerprintV2);
    if (prev !== undefined && now - prev < windowSec * 1000) return;
    lastFire.set(match.fingerprintV2, now);
    await ingestSweepMatch(rule, match);
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
async function subjectFor(device: AbstractDevice, organizationId: string) {
    return resolveSubjectForEvent(
        {
            kind: 'device_status_changed',
            organizationId,
            shellyID: device.shellyID,
            status: (device.status ?? {}) as Record<string, unknown>,
            device
        },
        PostgresProvider.callMethod
    );
}

async function eligible(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    organizationId: string
): Promise<boolean> {
    const subject = await subjectFor(device, organizationId);
    if (!matchesScope(rule.scope, subject)) return false;
    return deviceSupportsKind(capabilityViewOf(device), rule.kind, rule.config);
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
        device.shellyID,
        cfg.component,
        cfg.field
    );
    const prior = stuckSamples.get(key);
    if (!prior || prior.value !== value) {
        stuckSamples.set(key, {value, changedAt: now});
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
        now
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
    shellyID: string,
    from: Date,
    to: Date
): Promise<{consumptionKWh: number; sampleCount: number} | null> {
    const rows = await attributeWindowRepo.queryContributors({
        shellyIDs: [shellyID],
        from,
        to,
        bucket: pickAggregateBucket(to.getTime() - from.getTime()),
        metric: 'consumption',
        aggregation: 'sum'
    });
    const row = rows.find((r) => r.shellyID === shellyID) ?? rows[0];
    if (!row) return null;
    return {
        consumptionKWh: row.value,
        sampleCount: row.sampleCount
    };
}

async function evaluateEnergyConsumption(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    now: number
): Promise<void> {
    const cfg = readEnergyConsumptionConfig(rule.config);
    if (!cfg) return;
    const to = new Date(now);
    const from = new Date(now - cfg.windowSec * 1000);
    const reading = await readConsumptionWindowKWh(device.shellyID, from, to);
    if (!reading) {
        await markEvaluationState(
            rule,
            noDataMatch(rule, device.shellyID, {
                reason: 'missing_consumption_window',
                windowSec: cfg.windowSec
            }),
            'no_data'
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
            'no_data'
        );
        return;
    }
    await resolveFingerprint(
        rule,
        noDataMatch(rule, device.shellyID, {}).fingerprintV2
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
        if (rule.autoResolve) await resolveFingerprint(rule, fp);
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
        now
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
        device.shellyID,
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
    if (rate === null || Math.abs(rate) < cfg.deltaValue) return;
    await fireOnce(
        rule,
        synthesizeRateOfChangeMiss({
            ruleId: rule.id,
            ruleName: rule.name,
            shellyID: device.shellyID,
            component: cfg.component,
            field: cfg.field,
            rate,
            deltaValue: cfg.deltaValue,
            windowSec: cfg.windowSec
        }),
        now
    );
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
// device_offline's job, so heartbeat only watches connected-but-silent.
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
    if (heartbeatMissed(device.lastReportTs, now, interval, grace)) {
        // Gateway/native device itself is silent — one device-level miss. Its
        // BLU devices are silent as a consequence, so don't also fire per BLU.
        await fireOnce(
            rule,
            synthesizeHeartbeatMiss({
                ruleId: rule.id,
                ruleName: rule.name,
                shellyID: device.shellyID,
                expectedIntervalSec: interval
            }),
            now
        );
        return;
    }
    // Gateway is reporting, but a BLU device hanging off it can still be silent
    // on its own clock — fire one miss per silent BLU device.
    for (const t of bluLivenessTargets(device)) {
        const bluInterval = bluHeartbeatInterval(interval, t.floorSec);
        if (!heartbeatMissed(t.lastReportMs, now, bluInterval, grace)) continue;
        await fireOnce(
            rule,
            synthesizeHeartbeatMiss({
                ruleId: rule.id,
                ruleName: rule.name,
                shellyID: device.shellyID,
                expectedIntervalSec: bluInterval,
                component: t.component
            }),
            now
        );
    }
}

const TICK_KINDS: ReadonlySet<AlertRuleKind> = new Set([
    'device_offline',
    'stuck_sensor',
    'rate_of_change',
    'heartbeat',
    'energy_consumption_threshold'
]);

async function evaluateDeviceOffline(
    rule: LoadedAlertRule,
    row: StoredPresenceRow,
    organizationId: string,
    now: number
): Promise<void> {
    const shellyID = row.external_id;
    const live = DeviceCollector.getDevice(shellyID);
    const fingerprint = buildDeviceOfflineMatch(
        rule.id,
        rule.name,
        shellyID,
        row.name ?? (live?.info?.name as string | undefined)
    ).fingerprintV2;

    if (live?.presence === 'online' || live?.online === true) {
        if (rule.autoResolve) await resolveFingerprint(rule, fingerprint);
        return;
    }

    const subject = await resolveSubjectForEvent(
        {kind: 'device_offline', organizationId, shellyID, device: live},
        PostgresProvider.callMethod
    );
    if (!matchesScope(rule.scope, subject)) return;

    const lastSeenMs =
        timestampMs(row.last_seen) ?? timestampMs(live?.lastReportTs);
    if (lastSeenMs === null) {
        await markEvaluationState(
            rule,
            buildDeviceOfflineMatch(
                rule.id,
                rule.name,
                shellyID,
                row.name ?? (live?.info?.name as string | undefined),
                {
                    reason: 'missing_last_seen',
                    source: 'presence_store'
                }
            ),
            'no_data'
        );
        Observability.incrementCounter('alert_offline_no_last_seen');
        return;
    }

    const offlineForSec = offlineForSecOf(rule);
    if (offlineForSec !== null) {
        const dueAt = lastSeenMs + offlineForSec * 1000;
        if (now < dueAt) {
            await markEvaluationState(
                rule,
                buildDeviceOfflineMatch(
                    rule.id,
                    rule.name,
                    shellyID,
                    row.name ?? (live?.info?.name as string | undefined),
                    {
                        offlineForSec,
                        offlineSince: new Date(lastSeenMs).toISOString(),
                        pendingReason: 'offlineForSec',
                        remainingSec: Math.ceil((dueAt - now) / 1000),
                        source: 'presence_store'
                    }
                ),
                'pending'
            );
            await OutboxWorker.enqueueOfflineFire(
                {organizationId, ruleId: rule.id, shellyID},
                new Date(dueAt)
            );
            Observability.incrementCounter('alert_offline_pending_scheduled');
            return;
        }
    }

    await fireOnce(
        rule,
        buildDeviceOfflineMatch(
            rule.id,
            rule.name,
            shellyID,
            row.name ?? (live?.info?.name as string | undefined),
            {
                offlineForSec: offlineForSec ?? undefined,
                offlineSince: new Date(lastSeenMs).toISOString(),
                source: 'presence_store'
            }
        ),
        now
    );
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
}

// One tick: evaluate every enabled time/absence rule against its scoped,
// capable devices.
export async function runSweepForRules(
    organizationId: string,
    now: number,
    ruleIds?: readonly number[]
): Promise<void> {
    const only = ruleIds ? new Set(ruleIds) : null;
    const rules = (await sweepRulesFor(organizationId)).filter(
        (r) => TICK_KINDS.has(r.kind) && (!only || only.has(r.id))
    );
    if (rules.length === 0) return;

    const devices = DeviceCollector.getAll().filter(
        (d) => getDeviceOrg(d.shellyID) === organizationId
    );
    const storedPresence = rules.some((r) => r.kind === 'device_offline')
        ? await storedDevicePresence(organizationId)
        : [];

    for (const rule of rules) {
        if (rule.kind === 'device_offline') {
            for (const row of storedPresence) {
                try {
                    await evaluateDeviceOffline(rule, row, organizationId, now);
                    await resolveFingerprint(
                        rule,
                        evaluationErrorMatch(rule, row.external_id, '')
                            .fingerprintV2
                    );
                } catch (err) {
                    await markEvaluationState(
                        rule,
                        evaluationErrorMatch(rule, row.external_id, err),
                        'evaluation_error'
                    );
                    Observability.incrementCounter(
                        'alert_sweep_evaluation_errors'
                    );
                }
                Observability.incrementCounter('alert_sweep_evaluated');
            }
            continue;
        }
        for (const device of devices) {
            try {
                if (!(await eligible(rule, device, organizationId))) continue;
                await evaluateRule(rule, device, now);
                await resolveFingerprint(
                    rule,
                    evaluationErrorMatch(rule, device.shellyID, '')
                        .fingerprintV2
                );
            } catch (err) {
                await markEvaluationState(
                    rule,
                    evaluationErrorMatch(rule, device.shellyID, err),
                    'evaluation_error'
                );
                Observability.incrementCounter('alert_sweep_evaluation_errors');
            }
            Observability.incrementCounter('alert_sweep_evaluated');
        }
    }
}

export async function runSweepTick(now: number): Promise<void> {
    const orgs = await sweepOrgs();
    for (const organizationId of orgs) {
        await runSweepForRules(organizationId, now);
    }
    Observability.incrementCounter('alert_sweep_ticks');
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
        await runSweepTick(Date.now());
    } catch (err) {
        logger.error('alert sweep tick failed: %s', err);
    } finally {
        tickInProgress = false;
    }
}

export function startScheduler(): void {
    if (started) return;
    started = true;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(
        () => void onInterval(),
        tuning.alert.sweepIntervalSec * 1000
    );
    timer.unref?.();
    logger.info(
        'alert sweep started (interval=%ds)',
        tuning.alert.sweepIntervalSec
    );
    void onInterval();
}

export function stopScheduler(): void {
    if (!started) return;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    started = false;
    logger.info('alert sweep stopped');
}

export function isSchedulerRunning(): boolean {
    return started;
}
