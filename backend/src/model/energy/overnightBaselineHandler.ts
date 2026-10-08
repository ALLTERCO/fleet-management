// Energy.OvernightBaseline — the estate's learned night draw as one number,
// so a template does not sum 168-cell profiles itself.

import {getLogger} from 'log4js';
// Direct from leaf — the config/index.ts barrel drags plugin init into tests.
import {tuning} from '../../config/tuning';
import type {
    DevicePowerAvgRow,
    EnergyRepository,
    MeasurementPointHistoryRow
} from '../../modules/repositories/EnergyRepository';
import {runBoundedParallel} from '../../modules/util/runBoundedParallel';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {BASELINE_POWER_TAG} from '../../types/api/_baselineTags';
import {
    ENERGY_OVERNIGHT_BASELINE_DEFAULT_END,
    ENERGY_OVERNIGHT_BASELINE_DEFAULT_START,
    type EnergyOvernightBaselineParams,
    type EnergyOvernightBaselineResponse
} from '../../types/api/energy';
import type CommandSender from '../CommandSender';
import {dateInZone, type LocalDate} from '../report/localTimeInZone';
import {localTimeToUtc} from '../report/reportPeriod';
import {
    isAllDayWindow,
    isOvernightWindow,
    MINUTES_PER_DAY,
    parseTimeOfDay,
    windowRanges,
    windowSpan
} from '../timeWindow';
import type {BaselineFetcher, BaselineRow} from './baselineHandler';
import {
    accessibleShellyIds,
    type DeviceAccessSender
} from './deviceAccessFilter';
import {DEVICE_POWER_DOMAIN, DEVICE_POWER_TAG_PAIRS} from './devicePower';

const logger = getLogger('overnightBaseline');

const DEFAULT_MIN_WEEKS = 3;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const WATTS_PER_KW = 1000;
const PER_METER_TIMEOUT_MS = 60_000;

// The active-power pair the device-power ladder and the baseline both read.
const POWER_PHASE_TAG = BASELINE_POWER_TAG;
const POWER_TOTAL_TAG = DEVICE_POWER_TAG_PAIRS[POWER_PHASE_TAG];

// Energy rule: a bucket of 15 minutes or more reads the 15-minute rollup, a
// finer one reads raw. EnergyRepository routes on exactly this string.
const ROLLUP_BUCKET = '15 minutes';
const RAW_BUCKET = '5 minutes';
const ROLLUP_BUCKET_MINUTES = 15;

export type OvernightBaselineSender = CommandSender & DeviceAccessSender;

export interface OvernightBaselineDeps {
    /** The same per-(device, tag) baseline read Energy.Baseline uses. */
    fetchBaseline: BaselineFetcher;
    /** The organization's resolved IANA zone. Never the server clock. */
    organizationTimeZone: (organizationId: string) => Promise<string>;
    /** Injected so the "most recent completed night" is deterministic. */
    now?: () => Date;
}

interface MeterVerdict {
    ready: boolean;
    meanWatts: number | null;
    weeksObserved: number;
}

interface NightWindow {
    startMinutes: number;
    endMinutes: number;
    spanMinutes: number;
    hoursOfDay: ReadonlySet<number>;
}

function minutesOrThrow(value: string, field: string): number {
    const minutes = parseTimeOfDay(value);
    if (minutes === null || minutes >= MINUTES_PER_DAY) {
        throw RpcError.InvalidParams(`${field} must be a local HH:MM time`);
    }
    return minutes;
}

// The hours of a day the window covers. An hour counts when the window is open
// at the top of it, which is the grain the hour-of-week baseline is stored at.
function nightWindow(startMinutes: number, endMinutes: number): NightWindow {
    const hoursOfDay = new Set<number>();
    for (const range of windowRanges(
        startMinutes,
        endMinutes,
        MINUTES_PER_DAY
    )) {
        for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
            const at = hour * 60;
            if (at >= range.from && at < range.to) hoursOfDay.add(hour);
        }
    }
    return {
        startMinutes,
        endMinutes,
        spanMinutes: windowSpan(startMinutes, endMinutes, MINUTES_PER_DAY),
        hoursOfDay
    };
}

function priorLocalDay(date: LocalDate): LocalDate {
    const prior = new Date(Date.UTC(date.year, date.month - 1, date.day - 1));
    return {
        year: prior.getUTCFullYear(),
        month: prior.getUTCMonth() + 1,
        day: prior.getUTCDate()
    };
}

// The most recent window that has already closed, in the organization's zone.
// A window that wraps midnight (and an all-day one) started the local day
// before the one it ends on.
function lastCompletedNight(
    now: Date,
    timeZone: string,
    window: NightWindow
): {from: Date; to: Date} {
    let endDay = dateInZone(now, timeZone);
    let to = localTimeToUtc(endDay, window.endMinutes, timeZone);
    if (to.getTime() > now.getTime()) {
        endDay = priorLocalDay(endDay);
        to = localTimeToUtc(endDay, window.endMinutes, timeZone);
    }
    const startsDayBefore =
        isOvernightWindow(window.startMinutes, window.endMinutes) ||
        isAllDayWindow(window.startMinutes, window.endMinutes);
    const startDay = startsDayBefore ? priorLocalDay(endDay) : endDay;
    return {from: localTimeToUtc(startDay, window.startMinutes, timeZone), to};
}

// A meter is a readable device with stored AC-mains active power. Any other
// device in the place is not an energy meter and must not hold the estate at
// learning forever.
function powerMeters(
    history: readonly MeasurementPointHistoryRow[],
    idMap: Readonly<Record<number, string>>
): number[] {
    const meterIds = new Set<number>();
    for (const row of history) {
        if (row.domain !== DEVICE_POWER_DOMAIN) continue;
        if (row.tag !== POWER_PHASE_TAG && row.tag !== POWER_TOTAL_TAG)
            continue;
        meterIds.add(row.device);
    }
    return [...meterIds]
        .filter((deviceId) => idMap[deviceId] !== undefined)
        .sort((left, right) => left - right);
}

// The rebuild writes all 168 bins, so a missing night bin means the meter has
// no profile yet, not that the hour is quiet.
function judgeMeter(
    rows: readonly BaselineRow[],
    window: NightWindow
): MeterVerdict {
    const byHourOfWeek = new Map(
        rows.map((row) => [Number(row.hour_of_week), row])
    );
    const medians: number[] = [];
    let weeksObserved = Number.POSITIVE_INFINITY;
    let ready = true;
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
        for (const hour of window.hoursOfDay) {
            const row = byHourOfWeek.get(day * HOURS_PER_DAY + hour);
            if (!row) {
                ready = false;
                continue;
            }
            weeksObserved = Math.min(weeksObserved, Number(row.weeks_observed));
            if (!row.ready || row.median_val === null) {
                ready = false;
                continue;
            }
            medians.push(Number(row.median_val));
        }
    }
    if (!ready || medians.length === 0) {
        return {
            ready: false,
            meanWatts: null,
            weeksObserved: Number.isFinite(weeksObserved) ? weeksObserved : 0
        };
    }
    const mean =
        medians.reduce((sum, value) => sum + value, 0) / medians.length;
    return {ready: true, meanWatts: mean, weeksObserved};
}

// Per meter the mean of its measured buckets, then summed — the same shape as
// the learned side, so the two numbers are comparable.
function measuredKw(rows: readonly DevicePowerAvgRow[]): number | null {
    const perDevice = new Map<number, {sum: number; count: number}>();
    for (const row of rows) {
        const watts = Number(row.avg_w);
        if (!Number.isFinite(watts)) continue;
        const entry = perDevice.get(row.device) ?? {sum: 0, count: 0};
        entry.sum += watts;
        entry.count += 1;
        perDevice.set(row.device, entry);
    }
    if (perDevice.size === 0) return null;
    let watts = 0;
    for (const entry of perDevice.values()) watts += entry.sum / entry.count;
    return watts / WATTS_PER_KW;
}

function roundTo(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function emptyResponse(
    timeZone: string,
    start: string,
    end: string
): EnergyOvernightBaselineResponse {
    return {
        status: 'no_meters',
        timeZone,
        window: {start, end},
        metersConsidered: 0,
        metersReady: 0,
        weeksObserved: 0,
        baselineKw: null,
        lastNightKw: null,
        deviationPct: null
    };
}

export async function handleEnergyOvernightBaseline(
    params: EnergyOvernightBaselineParams,
    sender: OvernightBaselineSender,
    repo: EnergyRepository,
    deps: OvernightBaselineDeps
): Promise<EnergyOvernightBaselineResponse> {
    const organizationId = requireOrganizationId(sender, params);
    const start = params.nightStart ?? ENERGY_OVERNIGHT_BASELINE_DEFAULT_START;
    const end = params.nightEnd ?? ENERGY_OVERNIGHT_BASELINE_DEFAULT_END;
    const window = nightWindow(
        minutesOrThrow(start, 'nightStart'),
        minutesOrThrow(end, 'nightEnd')
    );
    const minWeeks = params.minWeeks ?? DEFAULT_MIN_WEEKS;
    const timeZone = await deps.organizationTimeZone(organizationId);

    const scoped = await repo.resolveScopeShellyIDs({
        orgId: organizationId,
        scopeKind: params.locationId === undefined ? 'fleet' : 'location',
        scopeId: params.locationId ?? null
    });
    const allowed = await accessibleShellyIds(scoped, sender);
    const readable = scoped.filter((shellyID) => allowed.has(shellyID));
    if (readable.length === 0) {
        return emptyResponse(timeZone, start, end);
    }

    const {internalIds, idMap} = await repo.resolveDevices(readable);
    const meters = powerMeters(
        await repo.listMeasurementPointHistory(internalIds),
        idMap
    );
    if (meters.length === 0) {
        return emptyResponse(timeZone, start, end);
    }

    // One call per meter: fm.fn_hour_of_week_baseline takes a single device, so
    // there is no set-shaped read to share. Bounded so a large estate cannot
    // open one connection per meter at once.
    const settled = await runBoundedParallel({
        tasks: meters,
        run: (deviceId) =>
            deps.fetchBaseline({
                organizationId,
                deviceId,
                channel: 0,
                tag: POWER_PHASE_TAG,
                minWeeks
            }),
        concurrency: tuning.energy.queryConcurrency,
        perTaskTimeoutMs: PER_METER_TIMEOUT_MS,
        label: 'energy-overnight-baseline',
        failFast: true
    });
    const verdicts = settled.map((result) =>
        result.status === 'fulfilled'
            ? judgeMeter(result.value, window)
            : {ready: false, meanWatts: null, weeksObserved: 0}
    );

    const ready = verdicts.filter((verdict) => verdict.ready);
    const allReady = ready.length === meters.length;
    const baselineKw = allReady
        ? roundTo(
              ready.reduce(
                  (sum, verdict) => sum + (verdict.meanWatts ?? 0),
                  0
              ) / WATTS_PER_KW,
              3
          )
        : null;
    const weeksObserved =
        ready.length === 0
            ? 0
            : Math.min(...ready.map((verdict) => verdict.weeksObserved));

    const night = lastCompletedNight(
        deps.now?.() ?? new Date(),
        timeZone,
        window
    );
    const measured = measuredKw(
        await repo.queryDevicePowerAvg({
            internalIds: meters,
            from: night.from,
            to: night.to,
            bucket:
                window.spanMinutes >= ROLLUP_BUCKET_MINUTES
                    ? ROLLUP_BUCKET
                    : RAW_BUCKET,
            phaseTag: POWER_PHASE_TAG,
            totalTag: POWER_TOTAL_TAG
        })
    );
    const lastNightKw = measured === null ? null : roundTo(measured, 3);
    const deviationPct =
        baselineKw !== null && baselineKw !== 0 && lastNightKw !== null
            ? roundTo(((lastNightKw - baselineKw) / baselineKw) * 100, 2)
            : null;

    logger.debug({
        method: 'Energy.OvernightBaseline',
        organizationId,
        locationId: params.locationId ?? null,
        timeZone,
        metersConsidered: meters.length,
        metersReady: ready.length,
        nightFrom: night.from.toISOString(),
        nightTo: night.to.toISOString()
    });

    return {
        status: allReady ? 'ready' : 'learning',
        timeZone,
        window: {start, end},
        metersConsidered: meters.length,
        metersReady: ready.length,
        weeksObserved,
        baselineKw,
        lastNightKw,
        deviationPct
    };
}
