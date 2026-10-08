import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import type {GaugeName} from '../observability/counters';
import * as PostgresProvider from '../PostgresProvider';
import {persistReportWorkerObservation} from '../reportPerformanceObservations';
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

export interface ReportQueueSnapshot {
    queuedCount: number;
    processingCount: number;
    workerOccupiedCount: number;
    oldestQueuedAgeMs: number;
}

let lastSnapshot: DeliveryMetricsSnapshot = emptySnapshot();
let timer: ReturnType<typeof setInterval> | null = null;

export function startDeliveryMetricsPolling(intervalMs: number): void {
    if (timer) return;
    fireAndForget('delivery-metrics.initial-refresh', () =>
        refreshDeliveryMetrics()
    );
    timer = setInterval(
        () =>
            fireAndForget('delivery-metrics.scheduled-refresh', () =>
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
        try {
            const reportRows = await PostgresProvider.queryRows<
                Record<string, unknown>
            >(
                `SELECT
                    COUNT(*) FILTER (
                        WHERE locked_at IS NULL
                          AND task_identifier = 'report_export'
                    ) AS queued_count,
                    COUNT(*) FILTER (
                        WHERE locked_at IS NOT NULL
                          AND task_identifier = 'report_export'
                    ) AS processing_count,
                    COUNT(*) FILTER (WHERE locked_at IS NOT NULL)
                        AS worker_occupied_count,
                    COALESCE(
                        EXTRACT(
                            EPOCH FROM (
                                NOW() - MIN(created_at)
                                FILTER (
                                    WHERE locked_at IS NULL
                                      AND task_identifier = 'report_export'
                                )
                            )
                        )::bigint * 1000,
                        0
                    ) AS oldest_queued_age_ms
                 FROM graphile_worker.jobs`
            );
            const reportSnapshot = normalizeReportQueueRow(reportRows[0]);
            publishReportQueueMetrics(reportSnapshot);
            await persistReportWorkerObservation(reportSnapshot);
        } catch {
            Observability.incrementCounter(
                'report_queue_metrics_refresh_errors'
            );
        }
        return lastSnapshot;
    } catch (err) {
        Observability.incrementCounter('delivery_metrics_refresh_errors');
        throw new Error(`delivery metrics refresh failed: ${formatError(err)}`);
    }
}

export function normalizeReportQueueRow(
    row: Record<string, unknown> | undefined
): ReportQueueSnapshot {
    return {
        queuedCount: readNumber(row?.queued_count),
        processingCount: readNumber(row?.processing_count),
        workerOccupiedCount: readNumber(row?.worker_occupied_count),
        oldestQueuedAgeMs: readNumber(row?.oldest_queued_age_ms)
    };
}

export function publishReportQueueMetrics(snapshot: ReportQueueSnapshot): void {
    const available = Math.max(
        0,
        tuning.delivery.outboxConcurrency - snapshot.workerOccupiedCount
    );
    Observability.setGauge('report_jobs_queued', snapshot.queuedCount);
    Observability.setGauge('report_jobs_processing', snapshot.processingCount);
    Observability.setGauge(
        'report_oldest_queued_age_seconds',
        snapshot.oldestQueuedAgeMs / 1000
    );
    Observability.setGauge('report_worker_capacity_available', available);
    Observability.setGauge(
        'report_worker_saturated',
        available === 0 && snapshot.queuedCount > 0 ? 1 : 0
    );
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

const DELIVERY_GAUGE_NAMES = {
    jobs_queued: 'notification_delivery_jobs_queued',
    jobs_processing: 'notification_delivery_jobs_processing',
    jobs_dead_letter: 'notification_delivery_jobs_dead_letter',
    jobs_failed_legacy: 'notification_delivery_jobs_failed_legacy',
    oldest_queued_age_ms: 'notification_delivery_oldest_queued_age_ms',
    attempts_15m: 'notification_delivery_attempts_15m',
    failed_attempts_15m: 'notification_delivery_failed_attempts_15m',
    terminal_latency_avg_ms: 'notification_delivery_terminal_latency_avg_ms',
    disabled_endpoints: 'notification_delivery_disabled_endpoints',
    auto_disabled_endpoints: 'notification_delivery_auto_disabled_endpoints'
} as const satisfies Record<string, GaugeName>;

function setDeliveryGauge(
    name: keyof typeof DELIVERY_GAUGE_NAMES,
    value: number
): void {
    Observability.setGauge(DELIVERY_GAUGE_NAMES[name], value);
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
