// Semantic validation the JSON schema can't express: a manual tariff's TOU
// windows must leave no uncovered time. An uncovered (weekday, minute) resolves
// to no window at report time and silently bills 0 — so reject it at save.
//
// Coverage mirrors the resolver (tariffResolver.ts): startTime === endTime is a
// 24h all-day sentinel; endTime <= startTime is an overnight wrap. daysMask bit
// i selects a weekday. 'live' tariffs carry no manual windows — prices come from
// the live source — so they are exempt, and so are 'block' tariffs, which price
// cumulative consumption rather than the clock. Block well-formedness is
// checked here instead.

import {MINUTES_PER_DAY} from '../../modules/util/timeUnits';
import RpcError from '../../rpc/RpcError';
import type {
    TariffBlockSpec,
    TariffDemandSeasonSpec,
    TariffDemandWindowSpec,
    TariffSeasonSpec,
    TariffSpec,
    TariffWindowSpec
} from '../../types/api/tariff';
import {seasonContains} from '../report/tariffResolver';
import {
    daysMaskSelects,
    parseTimeOfDay,
    priorDay,
    windowRanges
} from '../timeWindow';

// Mark the minutes a window covers on a sample weekday. The window rule and the
// midnight split come from model/timeWindow, shared with the resolver this
// validator has to mirror — that mirroring is the whole point of the file, and
// it used to be maintained by hand in two places.
//
// The after-midnight half of an overnight window belongs to the PRIOR selected
// weekday: a Friday 22:00-06:00 window owns Saturday's early hours.
function markWindow(
    covered: boolean[],
    window: TariffWindowSpec,
    sampleDay: number
): void {
    const start = parseTimeOfDay(window.startTime);
    const end = parseTimeOfDay(window.endTime);
    if (start === null || end === null) return;
    for (const range of windowRanges(start, end, MINUTES_PER_DAY)) {
        const owningDay = range.afterMidnight ? priorDay(sampleDay) : sampleDay;
        if (!daysMaskSelects(window.daysMask, owningDay)) continue;
        for (let i = range.from; i < range.to; i++) covered[i] = true;
    }
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
            markWindow(covered, window, dayBit);
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

// Same rule as markWindow, asked the other way round: does this window cover
// one (weekday, minute)? Shares the ranges so the two can never disagree.
function demandWindowMatchesMinute(
    window: TariffDemandWindowSpec,
    sampleDay: number,
    minute: number
): boolean {
    const start = parseTimeOfDay(window.startTime);
    const end = parseTimeOfDay(window.endTime);
    if (start === null || end === null) return false;
    return windowRanges(start, end, MINUTES_PER_DAY).some((range) => {
        if (minute < range.from || minute >= range.to) return false;
        const owningDay = range.afterMidnight ? priorDay(sampleDay) : sampleDay;
        return daysMaskSelects(window.daysMask, owningDay);
    });
}

function assertDemandUnambiguous(seasons: TariffDemandSeasonSpec[]): void {
    if (seasons.length === 0) {
        throw RpcError.Domain('ValidationFailed', {
            message: 'Demand pricing needs at least one season.'
        });
    }
    const calendar = new Set(everyMonthDay());
    for (const season of seasons) {
        if (
            !calendar.has(season.startMonthDay) ||
            !calendar.has(season.endMonthDay)
        ) {
            throw RpcError.Domain('ValidationFailed', {
                message: `Demand season ${season.startMonthDay}..${season.endMonthDay} has an invalid calendar date.`
            });
        }
        if (season.windows.length === 0) {
            throw RpcError.Domain('ValidationFailed', {
                message: `Demand season ${season.startMonthDay}..${season.endMonthDay} needs at least one window.`
            });
        }
    }
    for (const md of calendar) {
        if (seasons.filter((season) => seasonContains(season, md)).length > 1) {
            throw RpcError.Domain('ValidationFailed', {
                message: `Demand seasons overlap on ${md}; one instant cannot match two contracts.`
            });
        }
    }
    for (const season of seasons) {
        for (let day = 0; day < 7; day += 1) {
            for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
                if (
                    season.windows.filter((window) =>
                        demandWindowMatchesMinute(window, day, minute)
                    ).length > 1
                ) {
                    throw RpcError.Domain('ValidationFailed', {
                        message: `Demand windows overlap in season ${season.startMonthDay}..${season.endMonthDay} on ${WEEKDAY_LABEL[day]} at ${formatMinute(minute)}.`
                    });
                }
            }
        }
    }
}

// A stepped tariff prices cumulative consumption, so its blocks are the only
// thing that must be complete: ordered low to high, strictly growing, and open
// at the top. An out-of-order or repeated bound would make the marginal walk
// skip units; a mid-list unbounded block would make every block after it
// unreachable; and a bounded top block would bill everything above it at 0 —
// the same silent zero the window coverage check exists to prevent.
function assertBlocksWellFormed(blocks: TariffBlockSpec): void {
    const fail = (message: string): never => {
        throw RpcError.Domain('ValidationFailed', {message});
    };
    let previous = 0;
    for (let index = 0; index < blocks.steps.length; index++) {
        const {upTo} = blocks.steps[index];
        const isLast = index === blocks.steps.length - 1;
        if (upTo === null) {
            if (!isLast) {
                fail(
                    `Block ${index + 1} is unbounded but is not the last block. ` +
                        'Only the highest block may be open-ended.'
                );
            }
            return;
        }
        if (!(upTo > previous)) {
            fail(
                `Block ${index + 1} ends at ${upTo} ${blocks.unit}, which is not ` +
                    `above the previous block's ${previous} ${blocks.unit}. ` +
                    'Blocks must be ordered low to high and strictly growing.'
            );
        }
        if (isLast) {
            fail(
                `The highest block ends at ${upTo} ${blocks.unit}, so use above ` +
                    'it would bill 0. Give the last block upTo: null.'
            );
        }
        previous = upTo;
    }
}

// The two pricing sources are exclusive on purpose: a tariff that carried both
// windows and blocks would have two answers for the same kWh and no rule to
// pick one.
function assertBlockModeConsistent(spec: TariffSpec): void {
    if (spec.kind === 'block' && !spec.blocks) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                "A tariff of kind 'block' needs its consumption blocks. Add " +
                'blocks.steps, or pick a time-based kind.'
        });
    }
    if (spec.kind !== 'block' && spec.blocks) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                `A tariff of kind '${spec.kind}' cannot carry consumption ` +
                "blocks. Set kind to 'block' to price in blocks."
        });
    }
}

// Throws RpcError ValidationFailed on the first uncovered (season, weekday,
// minute) or uncovered calendar day. No-op for 'live' tariffs. Call before
// persisting a manual tariff.
export function assertTariffCoverage(spec: TariffSpec): void {
    if (spec.demand) assertDemandUnambiguous(spec.demand.seasons);
    assertBlockModeConsistent(spec);
    if (spec.blocks) assertBlocksWellFormed(spec.blocks);
    // 'live' takes its prices from a feed and 'block' from cumulative usage;
    // neither reads a window, so neither needs the clock covered.
    if (spec.kind === 'live' || spec.kind === 'block') return;
    assertSeasonsCoverYear(spec.seasons);
    for (const season of spec.seasons) assertSeasonCovered(season);
}
