// View helpers for the Bill page: what Bill.Quote is asked for, and how its
// answer is written. Pure functions only, so the panel stays a thin shell.

import type {
    BillQuoteDemandPeriod,
    BillQuoteDeviceUsage,
    BillQuoteParams,
    BillQuoteResponse,
    BillQuoteSeriesBucket,
    BillQuoteStatus,
    BillQuoteUsageBucket
} from '@api/bill';
import type {EnergyCommodity} from '@api/energy';
import type {DataColumn} from '@/components/core/DataList.vue';
import {
    findExactRecordedBill,
    type RecordedBillComparison,
    type RecordedBillLookup,
    type RecordedUtilityBill,
    recordedBillIdentity,
    recordedBillIdentityLabel,
    recordedBillPeriodDate
} from '@/components/dashboard/energy/billReconciliation';
import {
    formatDateParts,
    formatDateTimeParts,
    formatNumber
} from '@/helpers/format';
import {formatMoney} from '@/helpers/utilityAccounting';
import type {
    TariffResolutionPoint,
    TariffResolvedAssignment
} from '@/stores/billing';

/** A number the backend refused to price. Never softened to zero. */
export const UNAVAILABLE = 'unavailable';

/** Bill.Quote refuses a longer list (`meterIds.maxItems` in its params schema),
 *  so the bar says so before the wire does. */
export const BILL_QUOTE_MAX_METERS = 50;

export type BillScopeMode =
    | 'organization'
    | 'location'
    | 'device'
    | 'channel'
    | 'meters';

export const BILL_SCOPE_MODES: ReadonlyArray<{
    value: BillScopeMode;
    label: string;
}> = [
    {value: 'organization', label: 'Whole organization'},
    {value: 'location', label: 'One location'},
    {value: 'device', label: 'One device'},
    {value: 'channel', label: 'One channel'},
    {value: 'meters', label: 'Logical meters'}
];

export interface BillScopeSelection {
    mode: BillScopeMode;
    locationId: number | null;
    deviceId: string | null;
    channel: number | null;
    meterIds: readonly number[];
}

export interface BillQuoteSelection {
    from: string;
    to: string;
    commodity: EnergyCommodity;
    scope: BillScopeSelection;
    seriesBucket: BillQuoteSeriesBucket | null;
    avoidedImportCost: boolean;
}

/** Either a request Bill.Quote can answer, or the one thing still missing. */
export type BillQuoteRequest = {params: BillQuoteParams} | {issue: string};

type BillScopeNarrowing = Pick<
    BillQuoteParams,
    'scope' | 'devices' | 'channels' | 'meterIds'
>;
type BillScopeResolution = {narrowing: BillScopeNarrowing} | {issue: string};

const SCOPE_RESOLVERS: Record<
    BillScopeMode,
    (scope: BillScopeSelection) => BillScopeResolution
> = {
    organization: () => ({narrowing: {}}),
    location: (scope) =>
        scope.locationId === null
            ? {issue: 'Pick the location to bill.'}
            : {narrowing: {scope: {locationId: scope.locationId}}},
    device: (scope) =>
        scope.deviceId === null
            ? {issue: 'Pick the device to bill.'}
            : {narrowing: {devices: [scope.deviceId]}},
    channel: (scope) => resolveChannelScope(scope),
    meters: (scope) => resolveMeterScope(scope)
};

export function resolveBillQuoteRequest(
    selection: BillQuoteSelection
): BillQuoteRequest {
    const periodIssue = billPeriodIssue(selection);
    if (periodIssue) return {issue: periodIssue};
    const scope = SCOPE_RESOLVERS[selection.scope.mode](selection.scope);
    if ('issue' in scope) return scope;
    return {
        params: {
            from: selection.from,
            to: selection.to,
            commodity: selection.commodity,
            ...scope.narrowing,
            ...(selection.seriesBucket
                ? {seriesBucket: selection.seriesBucket}
                : {}),
            ...(selection.avoidedImportCost ? {avoidedImportCost: true} : {})
        }
    };
}

function resolveMeterScope(scope: BillScopeSelection): BillScopeResolution {
    if (scope.meterIds.length === 0) {
        return {issue: 'Pick at least one logical meter.'};
    }
    if (scope.meterIds.length > BILL_QUOTE_MAX_METERS) {
        return {
            issue: `Pick at most ${BILL_QUOTE_MAX_METERS} logical meters.`
        };
    }
    return {narrowing: {meterIds: [...scope.meterIds]}};
}

function resolveChannelScope(scope: BillScopeSelection): BillScopeResolution {
    if (scope.deviceId === null) return {issue: 'Pick the device to bill.'};
    if (scope.channel === null) return {issue: 'Pick the channel to bill.'};
    return {
        narrowing: {
            channels: [{device: scope.deviceId, channel: scope.channel}]
        }
    };
}

function billPeriodIssue(selection: BillQuoteSelection): string | null {
    if (!selection.from || !selection.to) return 'Pick a period to bill.';
    if (selection.from >= selection.to) {
        return 'The period must end after it starts.';
    }
    return null;
}

/** How many points one zone check may ask about. The contract caps a
 *  ResolveAssignments call at 1000 points and each point is asked twice. */
export const BILL_ZONE_CHECK_POINT_LIMIT = 1000;

const ASSIGNMENT_DIRECTIONS = ['import', 'export'] as const;

/** A device as the zone check needs it: its own id, where it sits, what it
 *  meters. */
export interface BillScopeDevice {
    id: number;
    deviceExternalId: string;
    locationId: number | null;
    channels: readonly number[];
}

/** One measuring point of a logical meter, named the way the meter names it. */
export interface BillScopeMeterPoint {
    deviceId: number;
    channel: number | null;
}

export interface BillScopePointsQuestion {
    scope: BillScopeSelection;
    commodity: EnergyCommodity;
    devices: readonly BillScopeDevice[];
    meterPoints: ReadonlyMap<number, readonly BillScopeMeterPoint[]>;
}

/** The points to ask the backend about, and what the ask leaves out. */
export interface BillScopePoints {
    points: TariffResolutionPoint[];
    /** Devices dropped because the ask hit the point limit. */
    uncheckedDevices: number;
    /** Meter points naming a device this page does not hold. */
    unknownMeterDevices: number;
}

/** A device and one of its channels, before the directions are added. */
interface ScopeTarget {
    deviceExternalId: string;
    channel: number | null;
}

/**
 * The points that make up a scope. The backend owns tariff precedence, so this
 * only says what to ask about; `tariff.ResolveAssignments` says which tariff
 * wins. A device that meters nothing still counts as one point, on channel null.
 */
export function billScopePoints(
    question: BillScopePointsQuestion
): BillScopePoints {
    const targets = scopeTargets(question);
    const capped = targets.slice(0, BILL_ZONE_CHECK_POINT_LIMIT / 2);
    const points: TariffResolutionPoint[] = capped.flatMap((target) =>
        ASSIGNMENT_DIRECTIONS.map((direction) => ({
            deviceExternalId: target.deviceExternalId,
            channel: target.channel,
            commodity: question.commodity,
            direction
        }))
    );
    return {
        points,
        uncheckedDevices: countUncheckedDevices(targets, capped),
        unknownMeterDevices: unknownMeterDevices(question)
    };
}

function countUncheckedDevices(
    targets: readonly ScopeTarget[],
    capped: readonly ScopeTarget[]
): number {
    const asked = new Set(capped.map((target) => target.deviceExternalId));
    const left = new Set(
        targets
            .slice(capped.length)
            .map((target) => target.deviceExternalId)
            .filter((id) => !asked.has(id))
    );
    return left.size;
}

function scopeTargets(question: BillScopePointsQuestion): ScopeTarget[] {
    const {scope} = question;
    if (scope.mode === 'organization') return devicePoints(question.devices);
    if (scope.mode === 'location') {
        if (scope.locationId === null) return [];
        return devicePoints(
            question.devices.filter(
                (device) => device.locationId === scope.locationId
            )
        );
    }
    if (scope.mode === 'device') {
        if (scope.deviceId === null) return [];
        return devicePoints(billedDevices(question, scope.deviceId));
    }
    if (scope.mode === 'channel') {
        if (scope.deviceId === null || scope.channel === null) return [];
        return [{deviceExternalId: scope.deviceId, channel: scope.channel}];
    }
    return meterTargets(question);
}

function billedDevices(
    question: BillScopePointsQuestion,
    deviceId: string
): BillScopeDevice[] {
    return question.devices.filter(
        (device) => device.deviceExternalId === deviceId
    );
}

function devicePoints(devices: readonly BillScopeDevice[]): ScopeTarget[] {
    return devices.flatMap((device): ScopeTarget[] =>
        device.channels.length === 0
            ? [{deviceExternalId: device.deviceExternalId, channel: null}]
            : device.channels.map((channel) => ({
                  deviceExternalId: device.deviceExternalId,
                  channel
              }))
    );
}

// A logical meter names its points by the internal device id; assignments are
// keyed on the external one, so the page's own device list joins the two.
function meterTargets(question: BillScopePointsQuestion): ScopeTarget[] {
    const externalIds = new Map(
        question.devices.map((device) => [device.id, device.deviceExternalId])
    );
    const seen = new Set<string>();
    const targets: ScopeTarget[] = [];
    for (const point of meterPointsInScope(question)) {
        const deviceExternalId = externalIds.get(point.deviceId);
        if (deviceExternalId === undefined) continue;
        const key = `${deviceExternalId}:${point.channel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({deviceExternalId, channel: point.channel});
    }
    return targets;
}

function meterPointsInScope(
    question: BillScopePointsQuestion
): BillScopeMeterPoint[] {
    return question.scope.meterIds.flatMap(
        (meterId) => question.meterPoints.get(meterId) ?? []
    );
}

function unknownMeterDevices(question: BillScopePointsQuestion): number {
    if (question.scope.mode !== 'meters') return 0;
    const known = new Set(question.devices.map((device) => device.id));
    const missing = new Set(
        meterPointsInScope(question)
            .map((point) => point.deviceId)
            .filter((deviceId) => !known.has(deviceId))
    );
    return missing.size;
}

/** One line when the zone check could not cover the whole scope. Both reasons
 *  leave the reader with the same hole, so they are counted as one number. */
export function billZoneCheckGap(asked: BillScopePoints): string | null {
    const missed = asked.uncheckedDevices + asked.unknownMeterDevices;
    if (missed === 0) return null;
    return `${missed} devices were not checked for a different billing clock.`;
}

/** The tariffs the backend named for these points, each one once. */
export function tariffIdsInResolution(
    resolution: readonly TariffResolvedAssignment[]
): number[] {
    const ids = resolution
        .map((answer) => answer.tariffId)
        .filter((id): id is number => typeof id === 'number');
    return [...new Set(ids)];
}

/** Identifies one zone check, so an answer that lands late is discarded. */
export function zoneCheckKey(points: readonly TariffResolutionPoint[]): string {
    return points
        .map(
            (point) =>
                `${point.deviceExternalId}:${point.channel}:${point.commodity}:${point.direction}`
        )
        .join('|');
}

/** One sentence when a scope mixes billing zones. Two tariffs on two clocks
 *  count different days, so their bills are never merged into one. */
export function mixedBillingZoneIssue(zones: readonly string[]): string | null {
    const named = [...new Set(zones)].sort();
    if (named.length < 2) return null;
    return `These devices bill on ${countInWords(named.length)} clocks, ${listInWords(named)}. Bill them one at a time.`;
}

// A small count reads better as a word; past ten the digit is clearer.
const COUNT_WORDS = new Map([
    [2, 'two'],
    [3, 'three'],
    [4, 'four'],
    [5, 'five'],
    [6, 'six'],
    [7, 'seven'],
    [8, 'eight'],
    [9, 'nine'],
    [10, 'ten']
]);

function countInWords(count: number): string {
    return COUNT_WORDS.get(count) ?? String(count);
}

function listInWords(items: readonly string[]): string {
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export interface BillPeriod {
    from: string;
    to: string;
}

/** The calendar days a period covers. Bill.List and recorded bills are keyed on
 *  the day, while a billing period bound is an instant whose day belongs to the
 *  tariff's own zone, never to UTC. */
export function billPeriodDates(
    period: BillPeriod,
    timezone: string | null
): BillPeriod {
    return {
        from: recordedBillPeriodDate(period.from, timezone),
        to: recordedBillPeriodDate(period.to, timezone)
    };
}

/** The days a bill covers and the zone they are counted in. The one home for
 *  that answer: every line naming the billed days calls it. */
export function billPeriodDaysLine(
    period: BillPeriod,
    timezone: string | null
): string {
    const from = billedDay(period.from, timezone);
    const to = billedDay(period.to, timezone);
    if (from === null || to === null) return `${period.from} to ${period.to}`;
    const span = readableSpan(from, to);
    return timezone === null ? span : `${span}, ${timezone}`;
}

// A bare bound is already a day, so every zone reads it alike. An instant is a
// day only in a known zone; a guessed one would name a day nobody billed.
function billedDay(bound: string, timezone: string | null): string | null {
    const day = recordedBillPeriodDate(bound, timezone);
    if (timezone !== null) return day;
    return day === bound ? day : null;
}

// The upper bound is the instant the period stops, so the last day it covers is
// the day before. An empty period has no day to name.
function readableSpan(from: string, to: string): string {
    const lastCovered = dayBefore(to);
    if (lastCovered === null || lastCovered < from) {
        return `${readableDay(from)} up to but not including ${readableDay(to)}`;
    }
    return `${readableDay(from)} to ${readableDay(lastCovered)}`;
}

/** The line under the period boxes: the days, plus what is still missing when
 *  no tariff has said which clock counts them. */
export function billPeriodZoneLine(
    period: BillPeriod,
    timezone: string | null
): string {
    const days = billPeriodDaysLine(period, timezone);
    if (timezone === null) {
        return `${days}. This period is not tied to a billing time zone yet. Choose the tariff whose billing periods to use.`;
    }
    return `${days} (from the tariff)`;
}

// Which calendar day this is was already decided upstream, in the tariff's
// own zone (billedDay / recordedBillPeriodDate) — this only WRITES that day
// out. It goes through the same region-aware home every other date and
// number on the page uses (helpers/format.ts), the flagship case being an
// American reader seeing an American date order on their own bill.
// timeZone: 'UTC' pins the rendered day to the UTC midnight this function
// anchors it at — without it a reader's own browser zone could roll the day
// forward or back, silently disagreeing with the day the tariff billed.
function readableDay(date: string): string {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return date;
    return formatDateParts(parsed, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    });
}

function dayBefore(date: string): string | null {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    parsed.setUTCDate(parsed.getUTCDate() - 1);
    return parsed.toISOString().slice(0, 10);
}

/** The last whole calendar month, so the page opens on a period that is over. */
export function defaultBillPeriod(now: Date): BillPeriod {
    return {
        from: calendarDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: calendarDate(new Date(now.getFullYear(), now.getMonth(), 1))
    };
}

function calendarDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** The billing store already turned the wire error into a sentence; show it. */
export function billErrorText(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export function formatBillAmount(
    value: number | null,
    currency: string | null
): string {
    if (value === null || !currency) return UNAVAILABLE;
    return formatMoney(value, currency);
}

export function formatBillNumber(value: number | null): string {
    if (value === null) return UNAVAILABLE;
    return formatNumber(value, {maximumFractionDigits: 3});
}

export function formatBillQuantity(value: number | null, unit: string): string {
    if (value === null) return UNAVAILABLE;
    return `${formatBillNumber(value)} ${unit}`;
}

/** A UTC instant written for a reader, in the organization's region. Null
 *  means the backend had none. */
export function formatBillInstant(value: string | null): string {
    if (value === null) return UNAVAILABLE;
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return value;
    return formatDateTimeParts(instant, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

type ReadyComparison = Extract<RecordedBillComparison, {status: 'ready'}>;

/** One sentence saying which side is higher and by how much. */
export function billDifferenceSentence(
    comparison: ReadyComparison,
    currency: string | null
): string {
    if (comparison.direction === 'match') {
        return 'The recorded bill and this calculation agree.';
    }
    const amount = formatBillAmount(Math.abs(comparison.varianceAbs), currency);
    const share =
        comparison.variancePct === null
            ? ''
            : ` (${formatBillNumber(Math.abs(comparison.variancePct))}%)`;
    const side = comparison.direction === 'over' ? 'more' : 'less';
    return `The utility charged ${amount}${share} ${side} than this calculation.`;
}

const BILL_STATUS_LABELS: Record<BillQuoteStatus, string> = {
    priced: 'Priced',
    partial: 'Partly priced',
    unconfigured: 'No price set'
};

const BILL_STATUS_BADGE_CLASSES: Record<BillQuoteStatus, string> = {
    priced: 'ua-badge--ok',
    partial: 'ua-badge--warn',
    unconfigured: 'ua-badge--warn'
};

export function billStatusLabel(status: BillQuoteStatus): string {
    return BILL_STATUS_LABELS[status];
}

export function billStatusBadgeClass(status: BillQuoteStatus): string {
    return BILL_STATUS_BADGE_CLASSES[status];
}

export interface RecordedBillMatch {
    bills: readonly RecordedUtilityBill[];
    period: BillPeriod;
    /** The zone the tariff bills in. The utility files a bill under its local
     *  day, so an instant bound is read there and nowhere else. */
    timezone: string | null;
    /** The recorded-bill list was cut short, so no match can be trusted. */
    truncated: boolean;
}

export function recordedBillLookupFor(
    match: RecordedBillMatch
): RecordedBillLookup {
    if (match.truncated) {
        return {
            status: 'unavailable',
            message:
                'Too many recorded bills match this period. Narrow the account or meter on the Recorded bills page before comparing.'
        };
    }
    const bill = findExactRecordedBill(
        match.bills,
        match.period.from,
        match.period.to,
        match.timezone
    );
    if (!bill) {
        const period = billPeriodDates(match.period, match.timezone);
        return {
            status: 'unavailable',
            message: `No recorded bill covers exactly ${period.from} to ${period.to}.`
        };
    }
    return {
        status: 'ready',
        bill,
        coverageWarning: recordedBillCoverageWarning(bill)
    };
}

function recordedBillCoverageWarning(bill: RecordedUtilityBill): string {
    return recordedBillIdentity(bill)
        ? `Matched on ${recordedBillIdentityLabel(bill)}. Check that this utility identity covers the scope you billed.`
        : 'This bill carries no account or meter, so only the period was matched.';
}

export interface BillQuoteUnits {
    currency: string | null;
    billedUnit: string;
    demandUnit: string;
}

export interface BillQuoteColumns {
    components: DataColumn<BillQuoteResponse['components'][number]>[];
    taxes: DataColumn<BillQuoteResponse['taxes'][number]>[];
    demand: DataColumn<BillQuoteDemandPeriod>[];
    devices: DataColumn<BillQuoteDeviceUsage>[];
    series: DataColumn<BillQuoteUsageBucket>[];
}

/** Every table header on the Bill page. The currency and the unit are named
 *  once here, so each cell below stays a bare number. */
export function billQuoteColumns(units: BillQuoteUnits): BillQuoteColumns {
    const money = headerSuffix(units.currency);
    const billed = headerSuffix(units.billedUnit);
    const demand = headerSuffix(units.demandUnit);
    return {
        components: [
            {key: 'name', label: 'Component', role: 'primary'},
            {key: 'code', label: 'Code', role: 'secondary', mono: true},
            {key: 'chargeClass', label: 'Charged as', role: 'meta'},
            {key: 'taxable', label: 'Taxable', role: 'meta'},
            {
                key: 'amount',
                label: `Amount${money}`,
                role: 'status',
                align: 'right'
            }
        ],
        taxes: [
            {key: 'name', label: 'Tax', role: 'primary'},
            {key: 'code', label: 'Code', role: 'secondary', mono: true},
            {key: 'ratePct', label: 'Rate', role: 'meta', align: 'right'},
            {key: 'calculation', label: 'Applied', role: 'meta'},
            {key: 'exempt', label: 'Exempt', role: 'meta'},
            {
                key: 'base',
                label: `Taxed amount${money}`,
                role: 'meta',
                align: 'right'
            },
            {
                key: 'amount',
                label: `Amount${money}`,
                role: 'status',
                align: 'right'
            }
        ],
        demand: [
            {key: 'periodKey', label: 'Period', role: 'primary'},
            {key: 'billingDays', label: 'Days', role: 'meta', align: 'right'},
            {
                key: 'measuredPeak',
                label: `Measured peak${demand}`,
                role: 'meta',
                align: 'right'
            },
            {
                key: 'billedPeak',
                label: `Billed peak${demand}`,
                role: 'meta',
                align: 'right'
            },
            {key: 'peakAt', label: 'Peak time', role: 'secondary'},
            {key: 'ratchetApplied', label: 'Minimum peak used', role: 'meta'},
            {
                key: 'charge',
                label: `Charge${money}`,
                role: 'status',
                align: 'right'
            }
        ],
        devices: [
            {key: 'device', label: 'Device', role: 'primary'},
            {key: 'status', label: 'Pricing', role: 'status'},
            {
                key: 'quantity',
                label: `Quantity${billed}`,
                role: 'meta',
                align: 'right'
            },
            {
                key: 'usageCharge',
                label: `Usage charge${money}`,
                role: 'meta',
                align: 'right'
            },
            {
                key: 'exportCredit',
                label: `Export credit${money}`,
                role: 'meta',
                align: 'right'
            },
            {
                key: 'netUsageCharge',
                label: `Net usage charge${money}`,
                role: 'secondary',
                align: 'right'
            }
        ],
        series: [
            {key: 'bucketStart', label: 'Starting', role: 'primary'},
            {
                key: 'quantity',
                label: `Quantity${billed}`,
                role: 'meta',
                align: 'right'
            },
            {
                key: 'usageCharge',
                label: `Usage charge${money}`,
                role: 'meta',
                align: 'right'
            },
            {
                key: 'netUsageCharge',
                label: `Net usage charge${money}`,
                role: 'status',
                align: 'right'
            }
        ]
    };
}

function headerSuffix(unit: string | null): string {
    return unit ? ` (${unit})` : '';
}
