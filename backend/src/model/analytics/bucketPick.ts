import {DAY_MS, HOUR_MS} from '../../modules/util/timeUnits';
// Window-size → continuous-aggregate bucket. The smallest bucket whose
// total row count stays under ~1000 wins; this mirrors what most chart
// libraries can usefully render and keeps PG plans cheap.

export type AggregateBucket = '1 minute' | '1 hour' | '1 day';

export function pickAggregateBucket(windowMs: number): AggregateBucket {
    if (windowMs <= HOUR_MS) return '1 minute';
    if (windowMs <= 7 * DAY_MS) return '1 hour';
    return '1 day';
}
