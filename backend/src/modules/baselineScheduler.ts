import * as log4js from 'log4js';
import {tuning} from '../config/tuning';
import {reportTimezoneFor} from '../model/report/energyEngineHelpers';
import {hourInZone} from '../model/report/localTimeInZone';
import {
    BASELINE_CHANNEL_ENERGY_TAGS,
    BASELINE_SENSOR_KINDS
} from '../types/api/_baselineTags';
import * as Observability from './Observability';
import * as PostgresProvider from './PostgresProvider';
import {isLeader, startLeaderGate} from './redis/leaderGate';

const logger = log4js.getLogger('BaselineScheduler');
const LEADER_NAME = 'hour-of-week-baseline-scheduler';

let timer: NodeJS.Timeout | null = null;
let running = false;
let tickInProgress = false;

export interface BaselineTickDeps {
    now: number;
    clock?: () => number;
    listOrganizations: () => Promise<readonly string[]>;
    listDevices: (
        organizationId: string,
        timezone: string,
        now: number
    ) => Promise<readonly number[]>;
    resolveTimezone: (organizationId: string) => Promise<string>;
    lastComputedAt: (
        organizationId: string,
        devices: readonly number[]
    ) => Promise<readonly DeviceBaselineStatus[]>;
    processBatch: (
        organizationId: string,
        devices: readonly number[],
        timezone: string
    ) => Promise<number>;
    deviceBatchSize: number;
    maxTickDurationMs: number;
    minRecomputeIntervalMs: number;
    runFromHour: number;
    runToHour: number;
}

export interface DeviceBaselineStatus {
    device: number;
    computedAtMs: number | null;
}

export interface BatchStepDeps {
    recordResiduals: (
        organizationId: string,
        devices: readonly number[],
        timezone: string
    ) => Promise<number>;
    detectChangePoints: (
        organizationId: string,
        devices: readonly number[],
        timezone: string
    ) => Promise<number>;
    rebuild: (
        organizationId: string,
        devices: readonly number[],
        timezone: string
    ) => Promise<number>;
    rebuildTempBands: (
        organizationId: string,
        devices: readonly number[],
        timezone: string
    ) => Promise<number>;
}

export interface BaselineTickResult {
    organizationsProcessed: number;
    organizationsSkipped: number;
    rowsWritten: number;
    failures: number;
    budgetExhausted: boolean;
}

function insideRunWindow(
    localHour: number,
    fromHour: number,
    toHour: number
): boolean {
    return localHour >= fromHour && localHour < toHour;
}

function isDue(
    lastComputedAtMs: number | null,
    nowMs: number,
    minIntervalMs: number
): boolean {
    return (
        lastComputedAtMs === null || nowMs - lastComputedAtMs >= minIntervalMs
    );
}

function batches<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

export async function runBatchSteps(
    steps: BatchStepDeps,
    organizationId: string,
    devices: readonly number[],
    timezone: string
): Promise<number> {
    const residuals = await steps.recordResiduals(
        organizationId,
        devices,
        timezone
    );
    const changes = await steps.detectChangePoints(
        organizationId,
        devices,
        timezone
    );
    Observability.incrementCounter('baseline_residual_days_written', residuals);
    if (changes > 0) {
        Observability.incrementCounter(
            'baseline_change_points_detected',
            changes
        );
    }
    const normal = await steps.rebuild(organizationId, devices, timezone);
    const banded = await steps.rebuildTempBands(
        organizationId,
        devices,
        timezone
    );
    return normal + banded;
}

export async function runBaselineTick(
    deps: BaselineTickDeps
): Promise<BaselineTickResult> {
    const clock = deps.clock ?? (() => Date.now());
    const deadline = clock() + deps.maxTickDurationMs;
    const result: BaselineTickResult = {
        organizationsProcessed: 0,
        organizationsSkipped: 0,
        rowsWritten: 0,
        failures: 0,
        budgetExhausted: false
    };

    for (const organizationId of await deps.listOrganizations()) {
        if (clock() >= deadline) {
            result.budgetExhausted = true;
            break;
        }
        try {
            const timezone = await deps.resolveTimezone(organizationId);
            const localHour = Math.floor(
                hourInZone(new Date(deps.now), timezone)
            );
            if (!insideRunWindow(localHour, deps.runFromHour, deps.runToHour)) {
                result.organizationsSkipped += 1;
                continue;
            }
            const devices = await deps.listDevices(
                organizationId,
                timezone,
                deps.now
            );
            const statuses = await deps.lastComputedAt(organizationId, devices);
            const statusByDevice = new Map(
                statuses.map((status) => [status.device, status.computedAtMs])
            );
            const dueDevices = devices.filter((device) =>
                isDue(
                    statusByDevice.get(device) ?? null,
                    deps.now,
                    deps.minRecomputeIntervalMs
                )
            );
            if (dueDevices.length === 0) {
                result.organizationsSkipped += 1;
                continue;
            }
            for (const batch of batches(dueDevices, deps.deviceBatchSize)) {
                if (clock() >= deadline) {
                    result.budgetExhausted = true;
                    break;
                }
                result.rowsWritten += await deps.processBatch(
                    organizationId,
                    batch,
                    timezone
                );
            }
            if (!result.budgetExhausted) result.organizationsProcessed += 1;
        } catch (err) {
            result.failures += 1;
            Observability.incrementCounter('baseline_rebuild_errors');
            logger.error(
                'baseline rebuild failed for org %s: %s',
                organizationId,
                err
            );
        }
    }
    return result;
}

async function listOrganizations(): Promise<string[]> {
    const rows = await PostgresProvider.queryRows<{organization_id: string}>(
        `SELECT DISTINCT organization_id
           FROM device.list
          WHERE organization_id IS NOT NULL
          ORDER BY organization_id`,
        []
    );
    return rows.map((row) => row.organization_id);
}

async function listDevices(
    organizationId: string,
    timezone: string,
    now: number
): Promise<number[]> {
    const rows = await PostgresProvider.queryRows<{id: number}>(
        `WITH bounds AS (
             SELECT date_trunc('day', $3::TIMESTAMPTZ AT TIME ZONE $2)
                        AT TIME ZONE $2 AS to_ts
         )
         SELECT d.id
           FROM bounds w,
                device.list d
           LEFT JOIN fm.hour_of_week_baseline baseline
             ON baseline.organization_id = d.organization_id
            AND baseline.device = d.id
          WHERE d.organization_id = $1
            AND (
                EXISTS (
                    SELECT 1
                      FROM device_em.energy_15min e
                     WHERE e.device = d.id
                       AND e.bucket >= w.to_ts - make_interval(days => $4)
                       AND e.bucket < w.to_ts
                       AND e.tag = ANY($5::VARCHAR(30)[])
                )
                OR EXISTS (
                    SELECT 1
                      FROM device_em.logical_energy_15min p
                     WHERE p.device = d.id
                       AND p.bucket >= w.to_ts - make_interval(days => $4)
                       AND p.bucket < w.to_ts
                       AND p.tag IN ('power', 'total_power')
                       AND p.commodity = 'electricity'
                       AND p.electrical_source IS NOT DISTINCT FROM 'ac_mains'
                       AND p.sample_count > 0
                )
                OR EXISTS (
                    SELECT 1
                      FROM device_sensor.numeric_15min n
                     WHERE n.device = d.id
                       AND n.bucket >= w.to_ts - make_interval(days => $4)
                       AND n.bucket < w.to_ts
                       AND n.source <> 'internal'
                       AND n.kind = ANY($6::VARCHAR(24)[])
                       AND n.sample_count > 0
                )
            )
          GROUP BY d.id
          ORDER BY MAX(baseline.computed_at) ASC NULLS FIRST, d.id`,
        [
            organizationId,
            timezone,
            new Date(now),
            tuning.baseline.windowDays,
            [...BASELINE_CHANNEL_ENERGY_TAGS],
            [...BASELINE_SENSOR_KINDS]
        ]
    );
    return rows.map((row) => Number(row.id)).filter(Number.isInteger);
}

async function lastComputedAt(
    organizationId: string,
    devices: readonly number[]
): Promise<readonly DeviceBaselineStatus[]> {
    if (devices.length === 0) return [];
    const rows = await PostgresProvider.queryRows<{
        device: number;
        computed_at: Date | null;
    }>(
        `SELECT d.id AS device, MAX(b.computed_at) AS computed_at
           FROM device.list d
           LEFT JOIN fm.hour_of_week_baseline b
             ON b.organization_id = d.organization_id
            AND b.device = d.id
          WHERE d.organization_id = $1
            AND d.id = ANY($2::INTEGER[])
          GROUP BY d.id
          ORDER BY d.id`,
        [organizationId, [...devices]]
    );
    return rows.map((row) => ({
        device: Number(row.device),
        computedAtMs: row.computed_at
            ? new Date(row.computed_at).getTime()
            : null
    }));
}

const productionSteps: BatchStepDeps = {
    recordResiduals: async (organizationId, devices, timezone) =>
        PostgresProvider.extractScalarNumber(
            await PostgresProvider.rawCall('fm.fn_baseline_record_residuals', {
                p_organization_id: organizationId,
                p_devices: [...devices],
                p_energy_tags: [...BASELINE_CHANNEL_ENERGY_TAGS],
                p_sensor_kinds: [...BASELINE_SENSOR_KINDS],
                p_include_power: true,
                p_tz: timezone,
                p_days: tuning.baseline.residualDays,
                p_min_weeks: tuning.baseline.minWeeks,
                p_now: new Date()
            })
        ),
    detectChangePoints: async (organizationId, devices, timezone) =>
        PostgresProvider.extractScalarNumber(
            await PostgresProvider.rawCall(
                'fm.fn_baseline_detect_change_points',
                {
                    p_organization_id: organizationId,
                    p_devices: [...devices],
                    p_tz: timezone,
                    p_lookback_days: tuning.baseline.windowDays,
                    p_k: tuning.baseline.cusumK,
                    p_h: tuning.baseline.cusumH,
                    p_min_days: tuning.baseline.minResidualDays,
                    p_now: new Date()
                }
            )
        ),
    rebuild: async (organizationId, devices, timezone) =>
        PostgresProvider.extractScalarNumber(
            await PostgresProvider.rawCall(
                'fm.fn_rebuild_hour_of_week_baseline',
                {
                    p_organization_id: organizationId,
                    p_devices: [...devices],
                    p_energy_tags: [...BASELINE_CHANNEL_ENERGY_TAGS],
                    p_sensor_kinds: [...BASELINE_SENSOR_KINDS],
                    p_include_power: true,
                    p_tz: timezone,
                    p_window_days: tuning.baseline.windowDays,
                    p_weekend_dows: [...tuning.baseline.weekendDows],
                    p_graduate_weeks: tuning.baseline.graduateWeeks,
                    p_now: new Date()
                }
            )
        ),
    rebuildTempBands: async (organizationId, devices, timezone) =>
        PostgresProvider.extractScalarNumber(
            await PostgresProvider.rawCall(
                'fm.fn_rebuild_baseline_temp_bands',
                {
                    p_organization_id: organizationId,
                    p_devices: [...devices],
                    p_energy_tags: [...BASELINE_CHANNEL_ENERGY_TAGS],
                    p_sensor_kinds: [...BASELINE_SENSOR_KINDS],
                    p_include_power: true,
                    p_tz: timezone,
                    p_window_days: tuning.baseline.windowDays,
                    p_weekend_dows: [...tuning.baseline.weekendDows],
                    p_now: new Date()
                }
            )
        )
};

function productionDeps(now: number): BaselineTickDeps {
    return {
        now,
        listOrganizations,
        listDevices,
        resolveTimezone: (organizationId) =>
            reportTimezoneFor(organizationId, undefined),
        lastComputedAt,
        processBatch: (organizationId, devices, timezone) =>
            runBatchSteps(productionSteps, organizationId, devices, timezone),
        deviceBatchSize: tuning.baseline.deviceBatchSize,
        maxTickDurationMs: tuning.baseline.maxTickDurationMs,
        minRecomputeIntervalMs: tuning.baseline.minRecomputeIntervalMs,
        runFromHour: tuning.baseline.runFromHour,
        runToHour: tuning.baseline.runToHour
    };
}

async function onInterval(): Promise<void> {
    if (!tuning.baseline.enabled) return;
    if (!isLeader(LEADER_NAME)) return;
    if (tickInProgress) return;
    tickInProgress = true;
    const startedAt = Date.now();
    try {
        const result = await runBaselineTick(productionDeps(startedAt));
        Observability.setGauge(
            'baseline_tick_duration_seconds',
            (Date.now() - startedAt) / 1_000
        );
        Observability.incrementCounter(
            'baseline_rows_written',
            result.rowsWritten
        );
        if (result.organizationsProcessed > 0 || result.failures > 0) {
            logger.info(
                'baseline rebuild: %d org(s), %d row(s), %d failure(s), budget %s',
                result.organizationsProcessed,
                result.rowsWritten,
                result.failures,
                result.budgetExhausted ? 'exhausted' : 'ok'
            );
        }
    } catch (err) {
        Observability.incrementCounter('baseline_tick_errors');
        logger.error('baseline tick failed: %s', err);
    } finally {
        tickInProgress = false;
    }
}

export function startScheduler(): void {
    if (running) {
        logger.warn('Baseline scheduler already running');
        return;
    }
    running = true;
    void startLeaderGate(LEADER_NAME);
    timer = setInterval(() => void onInterval(), tuning.baseline.intervalMs);
    timer.unref?.();
    logger.info(
        'Baseline scheduler started (interval=%dms, window=%dd, local %d:00-%d:00)',
        tuning.baseline.intervalMs,
        tuning.baseline.windowDays,
        tuning.baseline.runFromHour,
        tuning.baseline.runToHour
    );
}

export function stopScheduler(): void {
    running = false;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    logger.info('Baseline scheduler stopped');
}

export function isRunning(): boolean {
    return running;
}

export async function __runTickForTests(): Promise<void> {
    await onInterval();
}

Observability.registerModule('baselineScheduler', {
    stats: () => ({running: running ? 1 : 0}),
    topology: {
        role: 'service',
        cluster: 'services',
        zone: 'operations',
        upstreams: ['dbPool'],
        label: 'Hour-of-Week Baseline Scheduler',
        description: 'Nightly median-per-hour-of-week rebuild',
        route: '/monitoring/services'
    }
});
