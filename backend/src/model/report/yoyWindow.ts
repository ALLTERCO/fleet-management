// Year-over-year prior window. Subtracts 365 days (NOT a calendar year)
// so leap years stay stable — the goal is "same workload, one year ago",
// not a calendar-exact match. Result feeds into computeDelta() exactly
// like inferPriorWindow does.

import {DAY_MS} from '../../modules/util/timeUnits';
import type {PriorWindow, Window} from './periodDeltas';

const YOY_OFFSET_DAYS = 365;
const EPOCH_MS = 0;

export function inferYoyWindow({from, to}: Window): PriorWindow {
    const offsetMs = YOY_OFFSET_DAYS * DAY_MS;
    const priorFromMs = Math.max(EPOCH_MS, from.getTime() - offsetMs);
    const priorToMs = Math.max(EPOCH_MS, to.getTime() - offsetMs);
    return {
        priorFrom: new Date(priorFromMs),
        priorTo: new Date(priorToMs)
    };
}
