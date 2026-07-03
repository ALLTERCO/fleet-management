// Semantic validation the JSON schema can't express: a manual tariff's TOU
// windows must leave no uncovered time. An uncovered (weekday, minute) resolves
// to no window at report time and silently bills 0 — so reject it at save.
//
// Coverage mirrors the resolver (tariffResolver.ts): startTime === endTime is a
// 24h all-day sentinel; endTime <= startTime is an overnight wrap. daysMask bit
// i selects a weekday. 'live' tariffs carry no manual windows — prices come from
// the live source — so they are exempt.

import {MINUTES_PER_DAY} from '../../modules/util/timeUnits';
import RpcError from '../../rpc/RpcError';
import type {
    TariffSeasonSpec,
    TariffSpec,
    TariffWindowSpec
} from '../../types/api/tariff';
import {seasonContains} from '../report/tariffResolver';

function parseMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

// Mark the minutes a window covers on a single weekday.
function markWindow(covered: boolean[], window: TariffWindowSpec): void {
    const start = parseMinutes(window.startTime);
    const end = parseMinutes(window.endTime);
    if (start === end) {
        covered.fill(true); // all-day sentinel
        return;
    }
    if (end <= start) {
        // overnight wrap: [start, 24:00) + [00:00, end)
        for (let i = start; i < MINUTES_PER_DAY; i++) covered[i] = true;
        for (let i = 0; i < end; i++) covered[i] = true;
        return;
    }
    for (let i = start; i < end; i++) covered[i] = true;
}

function firstGapMinute(covered: boolean[]): number | null {
    for (let i = 0; i < MINUTES_PER_DAY; i++) if (!covered[i]) return i;
    return null;
}

function formatMinute(minute: number): string {
    const h = String(Math.floor(minute / 60)).padStart(2, '0');
    const m = String(minute % 60).padStart(2, '0');
    return `${h}:${m}`;
}

const WEEKDAY_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function assertSeasonCovered(season: TariffSeasonSpec): void {
    for (let dayBit = 0; dayBit < 7; dayBit++) {
        const covered: boolean[] = new Array(MINUTES_PER_DAY).fill(false);
        for (const window of season.windows) {
            if (((window.daysMask >> dayBit) & 1) === 1) {
                markWindow(covered, window);
            }
        }
        const gap = firstGapMinute(covered);
        if (gap !== null) {
            throw RpcError.Domain('ValidationFailed', {
                message:
                    `Tariff windows leave uncovered time in season ` +
                    `${season.startMonthDay}..${season.endMonthDay}: ` +
                    `${WEEKDAY_LABEL[dayBit]} at ${formatMinute(gap)} has no ` +
                    `window and would bill 0. Cover the full day.`
            });
        }
    }
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

// Every 'MM-DD' the seasons must cover. Walks a leap year day by day so Date
// handles month lengths (incl. 02-29) — no hardcoded days-per-month table.
const LEAP_YEAR = 2024;

function everyMonthDay(): string[] {
    const days: string[] = [];
    const date = new Date(Date.UTC(LEAP_YEAR, 0, 1));
    while (date.getUTCFullYear() === LEAP_YEAR) {
        days.push(`${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`);
        date.setUTCDate(date.getUTCDate() + 1);
    }
    return days;
}

// Per-season coverage proves each day is fully priced; this proves every
// calendar day falls in some season. Without it a date gap (or seasons:[])
// resolves to no window at report time and silently bills 0.
function assertSeasonsCoverYear(seasons: TariffSeasonSpec[]): void {
    if (seasons.length === 0) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                'A stored tariff needs at least one season covering the year.'
        });
    }
    for (const md of everyMonthDay()) {
        if (!seasons.some((s) => seasonContains(s, md))) {
            throw RpcError.Domain('ValidationFailed', {
                message:
                    `Tariff seasons leave ${md} uncovered — that date would ` +
                    `bill 0. Cover the whole year.`
            });
        }
    }
}

// Throws RpcError ValidationFailed on the first uncovered (season, weekday,
// minute) or uncovered calendar day. No-op for 'live' tariffs. Call before
// persisting a manual tariff.
export function assertTariffCoverage(spec: TariffSpec): void {
    if (spec.kind === 'live') return;
    assertSeasonsCoverYear(spec.seasons);
    for (const season of spec.seasons) assertSeasonCovered(season);
}
