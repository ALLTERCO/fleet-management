// Split hourly consumption into weekday vs weekend buckets. Reveals
// "your fridge ran all weekend at the same rate as a working day"
// leaks. Day-of-week is taken in the org timezone (null = UTC).

import {weekdayInZone} from './localTimeInZone';

export interface HourlySample {
    readonly hour: Date;
    readonly kWh: number;
}

export interface DayOfWeekSplit {
    readonly weekdayKWh: number;
    readonly weekendKWh: number;
    readonly weekdayPct: number; // 0..100, rounded to 1dp
    readonly weekendPct: number;
}

const SATURDAY = 6;
const SUNDAY = 0;

export function splitByDayOfWeek(
    samples: readonly HourlySample[],
    timezone: string | null = null
): DayOfWeekSplit {
    let weekday = 0;
    let weekend = 0;
    for (const sample of samples) {
        if (!isValidSample(sample)) continue;
        const day = weekdayInZone(sample.hour, timezone);
        if (day === SATURDAY || day === SUNDAY) weekend += sample.kWh;
        else weekday += sample.kWh;
    }
    return finalise(weekday, weekend);
}

function isValidSample(sample: HourlySample): boolean {
    return (
        sample.hour instanceof Date &&
        !Number.isNaN(sample.hour.getTime()) &&
        Number.isFinite(sample.kWh) &&
        sample.kWh >= 0
    );
}

function finalise(weekday: number, weekend: number): DayOfWeekSplit {
    const total = weekday + weekend;
    return {
        weekdayKWh: round3(weekday),
        weekendKWh: round3(weekend),
        weekdayPct: total > 0 ? round1((weekday / total) * 100) : 0,
        weekendPct: total > 0 ? round1((weekend / total) * 100) : 0
    };
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}
