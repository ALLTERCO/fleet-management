// Wraps device_em.fn_data_quality — owns the I/O; helper owns the result shape.

import {getLogger} from 'log4js';
import {GRANULARITY_MAP} from '../../config/energy';
import * as PostgresProvider from '../../modules/PostgresProvider';
import type {DataQualityResult} from './dataQuality';

const logger = getLogger('dataQualityRepo');

export interface DataQualityFetchInput {
    readonly deviceIds: readonly number[];
    readonly from: Date;
    readonly to: Date;
    readonly granularity: string;
}

interface Row {
    device: number;
    actual_buckets: number;
    expected: number;
    score: number | null;
}

const EMPTY: DataQualityResult = {
    overall: 1,
    expectedBucketsPerDevice: 0,
    perDevice: new Map()
};

export async function fetchDataQuality(
    input: DataQualityFetchInput
): Promise<DataQualityResult> {
    if (!hasFetchInput(input)) return EMPTY;
    const bucket = GRANULARITY_MAP[input.granularity];
    if (!bucket) return EMPTY;
    const rows = await fetchRowsBestEffort(input, bucket);
    return rows.length === 0 ? EMPTY : reshapeRows(rows);
}

function hasFetchInput({deviceIds, from, to}: DataQualityFetchInput): boolean {
    return deviceIds.length > 0 && to.getTime() > from.getTime();
}

// Reports must not fail because a coverage lookup did — DQ degrades to "100%".
async function fetchRowsBestEffort(
    {deviceIds, from, to}: DataQualityFetchInput,
    bucket: string
): Promise<Row[]> {
    try {
        const res = await PostgresProvider.callMethod(
            'device_em.fn_data_quality',
            {
                p_devices: [...deviceIds],
                p_from: from,
                p_to: to,
                p_bucket: bucket
            }
        );
        return (res?.rows ?? []) as Row[];
    } catch (err) {
        logger.warn(
            'data-quality fetch failed; section degraded: %s',
            err instanceof Error ? err.message : String(err)
        );
        return [];
    }
}

function reshapeRows(rows: readonly Row[]): DataQualityResult {
    const perDevice = new Map<number, number>();
    let sum = 0;
    for (const r of rows) {
        const score = r.score ?? 0;
        perDevice.set(r.device, +score.toFixed(3));
        sum += score;
    }
    return {
        overall: +(sum / rows.length).toFixed(3),
        // Window-level (same for every device row); callers guarantee rows>0.
        expectedBucketsPerDevice: rows[0].expected,
        perDevice
    };
}
