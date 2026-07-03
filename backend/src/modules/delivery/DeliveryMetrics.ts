import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {fireAndForget} from '../util/fireAndForget';
import {formatError} from '../util/formatError';

export interface DeliveryMetricsSnapshot {
    queuedCount: number;
    processingCount: number;
    deadLetterCount: number;
    failedCount: number;
    oldestQueuedAgeMs: number;
    attempts15m: number;
    failedAttempts15m: number;
    terminalLatencyAvgMs: number;
    disabledEndpointCount: number;
    autoDisabledEndpointCount: number;
}

let lastSnapshot: DeliveryMetricsSnapshot = emptySnapshot();
let timer: ReturnType<typeof setInterval> | null = null;

export function startDeliveryMetricsPolling(intervalMs: number): void {
    if (timer) return;
    fireAndForget('delivery-metrics.initial-refresh', refreshDeliveryMetrics());
    timer = setInterval(
        () =>
            fireAndForget(
                'delivery-metrics.scheduled-refresh',
                refreshDeliveryMetrics()
            ),
        intervalMs
    );
    timer.unref();
}

export function stopDeliveryMetricsPolling(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}

export function getDeliveryMetricsSnapshot(): DeliveryMetricsSnapshot {
    return lastSnapshot;
}

export async function refreshDeliveryMetrics(): Promise<DeliveryMetricsSnapshot> {
    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_delivery_metrics_snapshot',
            {}
        );
        lastSnapshot = normalizeDeliveryMetricsRow(result?.rows?.[0]);
        publishDeliveryMetrics(lastSnapshot);
        return lastSnapshot;
    } catch (err) {
        Observability.incrementCounter('delivery_metrics_refresh_errors');
        throw new Error(`delivery metrics refresh failed: ${formatError(err)}`);
    }
}

export function publishDeliveryMetrics(
    snapshot: DeliveryMetricsSnapshot
): void {
    setDeliveryGauge('jobs_queued', snapshot.queuedCount);
    setDeliveryGauge('jobs_processing', snapshot.processingCount);
    setDeliveryGauge('jobs_dead_letter', snapshot.deadLetterCount);
    setDeliveryGauge('jobs_failed_legacy', snapshot.failedCount);
    setDeliveryGauge('oldest_queued_age_ms', snapshot.oldestQueuedAgeMs);
    setDeliveryGauge('attempts_15m', snapshot.attempts15m);
    setDeliveryGauge('failed_attempts_15m', snapshot.failedAttempts15m);
    setDeliveryGauge('terminal_latency_avg_ms', snapshot.terminalLatencyAvgMs);
    setDeliveryGauge('disabled_endpoints', snapshot.disabledEndpointCount);
    setDeliveryGauge(
        'auto_disabled_endpoints',
        snapshot.autoDisabledEndpointCount
    );
}

export function normalizeDeliveryMetricsRow(
    row: Record<string, unknown> | undefined
): DeliveryMetricsSnapshot {
    if (!row) return emptySnapshot();
    return {
        queuedCount: readNumber(row.queued_count),
        processingCount: readNumber(row.processing_count),
        deadLetterCount: readNumber(row.dead_letter_count),
        failedCount: readNumber(row.failed_count),
        oldestQueuedAgeMs: readNumber(row.oldest_queued_age_ms),
        attempts15m: readNumber(row.attempts_15m),
        failedAttempts15m: readNumber(row.failed_attempts_15m),
        terminalLatencyAvgMs: readNumber(row.terminal_latency_avg_ms),
        disabledEndpointCount: readNumber(row.disabled_endpoint_count),
        autoDisabledEndpointCount: readNumber(row.auto_disabled_endpoint_count)
    };
}

function setDeliveryGauge(name: string, value: number): void {
    Observability.setGauge(`notification_delivery_${name}`, value);
}

function readNumber(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function emptySnapshot(): DeliveryMetricsSnapshot {
    return {
        queuedCount: 0,
        processingCount: 0,
        deadLetterCount: 0,
        failedCount: 0,
        oldestQueuedAgeMs: 0,
        attempts15m: 0,
        failedAttempts15m: 0,
        terminalLatencyAvgMs: 0,
        disabledEndpointCount: 0,
        autoDisabledEndpointCount: 0
    };
}
