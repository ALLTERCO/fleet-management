import type AbstractDevice from '../../model/AbstractDevice';
import {dateInZone} from '../../model/report/localTimeInZone';
import {resolveReportPeriod} from '../../model/report/reportPeriod';
import {localClock} from '../notification/localClock';
import * as PostgresProvider from '../PostgresProvider';
import {readVirtualDeviceRoleHistory} from '../virtualDevice/historyRepository';
import type {LoadedAlertRule, MatchResult} from './types';

export interface RecordIncompleteConfig {
    roleKey: string;
    deadlineHour: number;
    timeZone: string;
}

export interface ApproachingNewPeakConfig {
    intervalMinutes: 15 | 30;
    warningRatio: number;
    clearRatio: number;
    ratchetBaselineKw?: number;
    timeZone: string;
}

export function recordIncompleteConfig(
    config: Record<string, unknown>
): RecordIncompleteConfig | null {
    const {roleKey, deadlineHour, timeZone} = config;
    if (typeof roleKey !== 'string' || roleKey.length === 0) return null;
    if (
        !Number.isInteger(deadlineHour) ||
        Number(deadlineHour) < 0 ||
        Number(deadlineHour) > 23
    ) {
        return null;
    }
    if (typeof timeZone !== 'string' || timeZone.length === 0) return null;
    return {roleKey, deadlineHour: Number(deadlineHour), timeZone};
}

export function approachingNewPeakConfig(
    config: Record<string, unknown>
): ApproachingNewPeakConfig | null {
    const {
        intervalMinutes,
        warningRatio,
        clearRatio,
        ratchetBaselineKw,
        timeZone
    } = config;
    if (intervalMinutes !== 15 && intervalMinutes !== 30) return null;
    if (
        typeof warningRatio !== 'number' ||
        !Number.isFinite(warningRatio) ||
        warningRatio <= 0
    )
        return null;
    if (typeof timeZone !== 'string' || timeZone.length === 0) return null;
    const clear =
        typeof clearRatio === 'number' ? clearRatio : warningRatio * 0.9;
    if (!Number.isFinite(clear) || clear < 0 || clear > warningRatio)
        return null;
    if (
        ratchetBaselineKw !== undefined &&
        (typeof ratchetBaselineKw !== 'number' ||
            !Number.isFinite(ratchetBaselineKw) ||
            ratchetBaselineKw <= 0)
    ) {
        return null;
    }
    return {
        intervalMinutes,
        warningRatio,
        clearRatio: clear,
        ...(ratchetBaselineKw === undefined ? {} : {ratchetBaselineKw}),
        timeZone
    };
}

export function isPastRecordDeadline(
    now: Date,
    config: RecordIncompleteConfig
): boolean {
    const clock = localClock(now, config.timeZone);
    if (!clock) throw new Error(`invalid IANA timezone: ${config.timeZone}`);
    return clock.minuteOfDay >= config.deadlineHour * 60;
}

export async function latestRoleReadingAt(
    organizationId: string,
    externalId: string,
    roleKey: string,
    now: Date
): Promise<Date | null> {
    const result = await readVirtualDeviceRoleHistory(organizationId, {
        externalId,
        roleKey,
        from: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        to: now.toISOString(),
        bucket: '15 minutes',
        order: 'desc',
        limit: 1
    });
    const ts = result.items[0]?.ts;
    if (!ts) return null;
    const parsed = new Date(ts);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function readingIsFromLocalToday(
    readingAt: Date | null,
    now: Date,
    timeZone: string
): boolean {
    if (!readingAt) return false;
    const reading = dateInZone(readingAt, timeZone);
    const today = dateInZone(now, timeZone);
    return (
        reading.year === today.year &&
        reading.month === today.month &&
        reading.day === today.day
    );
}

interface DemandComparisonRow {
    current_kw: number | string | null;
    baseline_kw: number | string | null;
}

export interface DemandPeakComparison {
    currentKw: number;
    baselineKw: number;
}

export async function readDemandPeakComparison(
    organizationId: string,
    deviceId: number,
    now: Date,
    config: ApproachingNewPeakConfig
): Promise<DemandPeakComparison | null> {
    if (!localClock(now, config.timeZone)) {
        throw new Error(`invalid IANA timezone: ${config.timeZone}`);
    }
    const current = resolveReportPeriod('mtd', now, config.timeZone);
    const rows = await PostgresProvider.queryRows<DemandComparisonRow>(
        `WITH blocks AS (
             SELECT time_bucket(make_interval(mins => $5::int), energy.bucket) AS block,
                    SUM(energy.sum_val) * 60.0 / ($5::double precision * 1000.0) AS kw
               FROM device_em.energy_15min energy
               JOIN device.list device ON device.id = energy.device
              WHERE energy.device = $2 AND device.organization_id = $1
                AND energy.tag = 'total_act_energy'
                AND energy.bucket >= $3 AND energy.bucket < $4
              GROUP BY 1
             HAVING COUNT(DISTINCT energy.bucket) >= $5::int / 15
         ), latest AS (
             SELECT block, kw
               FROM blocks
              WHERE block + make_interval(mins => $5::int) <= $4
              ORDER BY block DESC
              LIMIT 1
         )
         SELECT latest.kw AS current_kw,
                CASE
                    WHEN MAX(prior.kw) IS NULL THEN $6::double precision
                    WHEN $6::double precision IS NULL THEN MAX(prior.kw)
                    ELSE GREATEST(MAX(prior.kw), $6::double precision)
                END AS baseline_kw
           FROM latest
           LEFT JOIN blocks prior ON prior.block < latest.block
          GROUP BY latest.kw`,
        [
            organizationId,
            deviceId,
            current.from,
            now,
            config.intervalMinutes,
            config.ratchetBaselineKw ?? null
        ]
    );
    const row = rows[0];
    if (
        row?.current_kw === null ||
        row?.current_kw === undefined ||
        row.baseline_kw === null ||
        row.baseline_kw === undefined
    ) {
        return null;
    }
    const currentKw = Number(row.current_kw);
    const baselineKw = Number(row.baseline_kw);
    if (
        !Number.isFinite(currentKw) ||
        !Number.isFinite(baselineKw) ||
        baselineKw <= 0
    ) {
        return null;
    }
    return {currentKw, baselineKw};
}

function deviceLabel(device: AbstractDevice): string {
    const name = device.info?.name;
    return typeof name === 'string' && name.trim()
        ? name.trim()
        : device.shellyID;
}

export function recordIncompleteMatch(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    config: RecordIncompleteConfig,
    latestReadingAt: Date | null
): MatchResult {
    const label = deviceLabel(device);
    return {
        fingerprintV2: `rule:${rule.id}:device:${device.shellyID}`,
        title: `${label} daily record is incomplete`,
        message: `${label} has no temperature reading today. Check the probe and record the case temperature.`,
        subject: {type: 'device', id: device.shellyID},
        context: {
            shellyID: device.shellyID,
            roleKey: config.roleKey,
            deadlineHour: config.deadlineHour,
            timeZone: config.timeZone,
            latestReadingAt: latestReadingAt?.toISOString() ?? null
        }
    };
}

export function approachingNewPeakMatch(
    rule: LoadedAlertRule,
    device: AbstractDevice,
    config: ApproachingNewPeakConfig,
    comparison: DemandPeakComparison
): MatchResult {
    const label = deviceLabel(device);
    const ratio = comparison.currentKw / comparison.baselineKw;
    return {
        fingerprintV2: `rule:${rule.id}:device:${device.shellyID}`,
        title: `${label} is approaching a new demand peak`,
        message: `${config.intervalMinutes}-minute demand is ${comparison.currentKw.toFixed(1)} kW (${Math.round(ratio * 100)}% of the current ${comparison.baselineKw.toFixed(1)} kW billing peak). Reduce discretionary load now.`,
        subject: {type: 'device', id: device.shellyID},
        context: {
            shellyID: device.shellyID,
            intervalMinutes: config.intervalMinutes,
            currentKw: comparison.currentKw,
            baselineKw: comparison.baselineKw,
            ratio,
            warningRatio: config.warningRatio,
            timeZone: config.timeZone
        }
    };
}
