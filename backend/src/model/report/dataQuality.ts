import {DAY_MS, HOUR_MS, MINUTE_MS} from '../../modules/util/timeUnits';
// Coverage score: actual reporting buckets vs expected.

export type Granularity = 'minute' | 'hour' | 'day' | 'week' | 'month';

export interface BucketSample {
    readonly device: number;
    readonly bucket: string | Date;
}

export interface DataQualityInput {
    readonly samples: readonly BucketSample[];
    readonly deviceIds: readonly number[];
    readonly from: Date;
    readonly to: Date;
    readonly granularity: Granularity;
}

export interface DataQualityResult {
    readonly overall: number;
    readonly expectedBucketsPerDevice: number;
    readonly perDevice: ReadonlyMap<number, number>;
}

const WEEK_MS = 7 * DAY_MS;
// Months use a 30-day approximation; irrelevant near score=1.0.
const MONTH_MS = 30 * DAY_MS;

const BUCKET_SPAN_MS: Readonly<Record<Granularity, number>> = {
    minute: MINUTE_MS,
    hour: HOUR_MS,
    day: DAY_MS,
    week: WEEK_MS,
    month: MONTH_MS
};

export function computeDataQuality(input: DataQualityInput): DataQualityResult {
    if (isEmptyWindow(input)) return emptyResult();
    const expected = expectedBucketsFor(input);
    const bucketsByDevice = indexBucketsByDevice(input.samples);
    const perDevice = scorePerDevice(
        input.deviceIds,
        bucketsByDevice,
        expected
    );
    return {
        overall: averageScore(perDevice),
        expectedBucketsPerDevice: expected,
        perDevice
    };
}

function isEmptyWindow({from, to, deviceIds}: DataQualityInput): boolean {
    return to.getTime() - from.getTime() <= 0 || deviceIds.length === 0;
}

function emptyResult(): DataQualityResult {
    return {overall: 1, expectedBucketsPerDevice: 0, perDevice: new Map()};
}

function expectedBucketsFor({from, to, granularity}: DataQualityInput): number {
    const span = to.getTime() - from.getTime();
    return Math.max(1, Math.ceil(span / BUCKET_SPAN_MS[granularity]));
}

function indexBucketsByDevice(
    samples: readonly BucketSample[]
): Map<number, Set<string>> {
    const out = new Map<number, Set<string>>();
    for (const s of samples) {
        const key = bucketKey(s.bucket);
        const set = out.get(s.device) ?? new Set<string>();
        set.add(key);
        out.set(s.device, set);
    }
    return out;
}

function bucketKey(bucket: string | Date): string {
    return typeof bucket === 'string' ? bucket : bucket.toISOString();
}

function scorePerDevice(
    deviceIds: readonly number[],
    bucketsByDevice: Map<number, Set<string>>,
    expected: number
): Map<number, number> {
    const perDevice = new Map<number, number>();
    for (const id of deviceIds) {
        const actual = bucketsByDevice.get(id)?.size ?? 0;
        const score = Math.min(1, actual / expected);
        perDevice.set(id, +score.toFixed(3));
    }
    return perDevice;
}

function averageScore(perDevice: Map<number, number>): number {
    if (perDevice.size === 0) return 1;
    let sum = 0;
    for (const v of perDevice.values()) sum += v;
    return +(sum / perDevice.size).toFixed(3);
}
