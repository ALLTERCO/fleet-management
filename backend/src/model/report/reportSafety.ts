import {tuning} from '../../config';
import {GRANULARITY_MAP} from '../../config/energy';
import {DAY_MS, HOUR_MS, MINUTE_MS} from '../../modules/util/timeUnits';
import RpcError from '../../rpc/RpcError';

export interface ReportSafetyRequest {
    deviceCount: number;
    from: Date;
    to: Date;
    granularity: string;
    seriesCount: number;
}

export function assertReportSafety(request: ReportSafetyRequest): void {
    assertReportDeviceCount(request.deviceCount);
    assertReportRange(request);
    assertReportEstimatedRows(estimateReportRows(request));
}

export function assertReportDeviceCount(deviceCount: number): void {
    if (deviceCount <= tuning.report.maxDevices) return;
    throw RpcError.InvalidParams(
        `report targets ${deviceCount} devices; max is ${tuning.report.maxDevices}`
    );
}

function assertReportEstimatedRows(rowCount: number): void {
    // maxRows <= 0 disables the pre-flight row ceiling. The timeseries export
    // now paginates into bucket-aligned, bounded per-window statements
    // (constant memory, each within statement_timeout), so total row count is
    // no longer a memory/timeout risk — maxDevices + maxRangeDays remain the
    // outer bounds. A positive maxRows still caps as a sanity guard.
    if (tuning.report.maxRows <= 0) return;
    if (rowCount <= tuning.report.maxRows) return;
    throw RpcError.InvalidParams(
        `report would generate about ${rowCount} rows; max is ${tuning.report.maxRows}`
    );
}

function assertReportRange(request: ReportSafetyRequest): void {
    const rangeDays =
        Math.max(0, request.to.getTime() - request.from.getTime()) / DAY_MS;
    if (rangeDays <= tuning.report.maxRangeDays) return;
    throw RpcError.InvalidParams(
        `report range is ${Math.ceil(rangeDays)} days; max is ${tuning.report.maxRangeDays}`
    );
}

export function estimateReportRows(request: ReportSafetyRequest): number {
    return (
        Math.max(1, request.deviceCount) *
        Math.max(1, bucketCount(request)) *
        Math.max(1, request.seriesCount)
    );
}

function bucketCount(request: ReportSafetyRequest): number {
    const spanMs = Math.max(0, request.to.getTime() - request.from.getTime());
    const bucketMs = bucketSizeMs(request.granularity);
    return Math.max(1, Math.ceil(spanMs / bucketMs));
}

// Real bucket size per granularity, derived from the canonical
// GRANULARITY_MAP ("15 minutes", "1 hour", ...). A previous string-match
// version returned one day for every sub-hour bucket, so 15-minute reports
// under-counted rows ~96x and slipped past the row cap.
const UNIT_MS: Record<string, number> = {
    minute: MINUTE_MS,
    hour: HOUR_MS,
    day: DAY_MS,
    week: 7 * DAY_MS,
    month: 31 * DAY_MS
};

export function bucketSizeMs(granularity: string): number {
    const interval = GRANULARITY_MAP[granularity];
    if (!interval) return DAY_MS;
    const [count, unit] = interval.split(' ');
    const unitMs = UNIT_MS[unit.replace(/s$/, '')];
    if (!unitMs) return DAY_MS;
    return Number(count) * unitMs;
}
