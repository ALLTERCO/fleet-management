import {localClock} from './localClock';
import type {RoutingEvaluationMatch} from './RoutingPolicyEvaluator';
import {readObject, readString, readStringArray} from './rowReaders';

export interface RoutingSuppressionInput {
    matches: RoutingEvaluationMatch[];
    at: Date;
}

export interface ActiveRoutingMatch {
    match: RoutingEvaluationMatch;
    suppressed: false;
}

export interface SuppressedRoutingMatch {
    match: RoutingEvaluationMatch;
    suppressed: true;
    reason: 'runtime_silence' | 'mute_window';
}

export type RoutingSuppressionResult =
    | ActiveRoutingMatch
    | SuppressedRoutingMatch;

export function evaluateRoutingSuppressions(
    input: RoutingSuppressionInput
): RoutingSuppressionResult[] {
    return input.matches.map((match) => evaluateOneMatch(match, input.at));
}

export function activeRoutingMatches(
    input: RoutingSuppressionInput
): RoutingEvaluationMatch[] {
    return evaluateRoutingSuppressions(input)
        .filter((result): result is ActiveRoutingMatch => !result.suppressed)
        .map((result) => result.match);
}

function evaluateOneMatch(
    match: RoutingEvaluationMatch,
    at: Date
): RoutingSuppressionResult {
    if (hasActiveRuntimeSilence(match.runtimeSilences, at)) {
        return {match, suppressed: true, reason: 'runtime_silence'};
    }
    if (hasActiveMuteWindow(match.muteWindows, at)) {
        return {match, suppressed: true, reason: 'mute_window'};
    }
    return {match, suppressed: false};
}

function hasActiveRuntimeSilence(entries: unknown[], at: Date): boolean {
    return entries.some((entry) => intervalContains(entry, at));
}

function hasActiveMuteWindow(entries: unknown[], at: Date): boolean {
    return entries.some(
        (entry) =>
            intervalContains(entry, at) || weeklyWindowContains(entry, at)
    );
}

function intervalContains(entry: unknown, at: Date): boolean {
    const record = readObject(entry);
    if (record.enabled === false) return false;
    const start = readDate(record.startsAt ?? record.startAt ?? record.from);
    const end = readDate(record.endsAt ?? record.endAt ?? record.until);
    if (!start && !end) return false;
    const atMs = at.getTime();
    if (start && atMs < start.getTime()) return false;
    if (end && atMs >= end.getTime()) return false;
    return true;
}

function weeklyWindowContains(entry: unknown, at: Date): boolean {
    const record = readObject(entry);
    if (record.enabled === false) return false;
    // Weekdays compare case-insensitively against the lowercased local day.
    const weekdays = readStringArray(record.weekdays ?? record.days).map(
        (day) => day.toLowerCase()
    );
    const start = parseClock(record.startTime ?? record.start);
    const end = parseClock(record.endTime ?? record.end);
    if (weekdays.length === 0 || !start || !end) return false;
    const local = localClock(at, readString(record.timezone) ?? 'UTC');
    if (!local) return false;
    if (!weekdays.includes(local.weekday)) return false;
    return clockFallsInWindow(local.minuteOfDay, start, end);
}

function clockFallsInWindow(
    minuteOfDay: number,
    startMinute: number,
    endMinute: number
): boolean {
    // Equal start/end = empty window, not all-day.
    if (startMinute === endMinute) return false;
    if (startMinute < endMinute) {
        return minuteOfDay >= startMinute && minuteOfDay < endMinute;
    }
    return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

function parseClock(value: unknown): number | null {
    const text = readString(value);
    if (!text) return null;
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

function readDate(value: unknown): Date | null {
    const text = readString(value);
    if (!text) return null;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
}
