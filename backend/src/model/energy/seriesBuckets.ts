// Calendar-correct UTC boundaries for the Bill.Quote usage series.
//
// A drill-down bar must cover exactly the interval its label claims, so these
// mirror TimescaleDB `time_bucket` for the Energy.* bucket vocabulary: fixed
// widths floor against the UNIX epoch, weeks use time_bucket's Monday origin
// (2000-01-03), and months are real calendar months. Pure — no DB, no clock.

import type {BillQuoteSeriesBucket} from '../../types/api/bill';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
// TimescaleDB's default week origin. Monday, so weeks start on Monday UTC.
const WEEK_ORIGIN_MS = Date.UTC(2000, 0, 3);

const FIXED_WIDTH_MS: Partial<Record<BillQuoteSeriesBucket, number>> = {
    '15 minutes': 15 * MINUTE_MS,
    '30 minutes': 30 * MINUTE_MS,
    '1 hour': HOUR_MS,
    '6 hours': 6 * HOUR_MS,
    '12 hours': 12 * HOUR_MS,
    '1 day': DAY_MS,
    '1 week': WEEK_MS
};

function fixedWidthMs(bucket: BillQuoteSeriesBucket): number | null {
    return FIXED_WIDTH_MS[bucket] ?? null;
}

/** Start of the series bucket containing `at`. */
export function seriesBucketStart(
    at: Date,
    bucket: BillQuoteSeriesBucket
): Date {
    const ms = at.getTime();
    const width = fixedWidthMs(bucket);
    if (width === null) {
        return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    }
    const origin = bucket === '1 week' ? WEEK_ORIGIN_MS : 0;
    return new Date(Math.floor((ms - origin) / width) * width + origin);
}

/** Exclusive end of a bucket that starts at `start`. */
export function seriesBucketEnd(
    start: Date,
    bucket: BillQuoteSeriesBucket
): Date {
    const width = fixedWidthMs(bucket);
    if (width === null) {
        return new Date(
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
        );
    }
    return new Date(start.getTime() + width);
}

/**
 * How many series buckets the half-open window [from, to) spans. Callers use
 * this to refuse an over-fine request before reading any measurement, so a
 * one-minute drill-down over a decade fails closed instead of being truncated.
 */
export function seriesBucketCount(
    from: Date,
    to: Date,
    bucket: BillQuoteSeriesBucket
): number {
    if (!(to.getTime() > from.getTime())) return 0;
    const start = seriesBucketStart(from, bucket);
    const width = fixedWidthMs(bucket);
    if (width !== null) {
        return Math.ceil((to.getTime() - start.getTime()) / width);
    }
    const last = seriesBucketStart(new Date(to.getTime() - 1), bucket);
    return (
        (last.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (last.getUTCMonth() - start.getUTCMonth()) +
        1
    );
}
