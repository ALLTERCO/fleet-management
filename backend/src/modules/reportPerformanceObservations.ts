import {tuning} from '../config/tuning';
import * as Observability from './Observability';
import * as PostgresProvider from './PostgresProvider';

type CallMethod = typeof PostgresProvider.callMethod;

interface ReportWorkerObservation {
    queuedCount: number;
    processingCount: number;
    workerOccupiedCount: number;
    oldestQueuedAgeMs: number;
}

interface PdfRenderObservation {
    durationMs: number;
    complexRows: number;
    failed: boolean;
}

export async function persistReportWorkerObservation(
    snapshot: ReportWorkerObservation,
    callMethod: CallMethod = PostgresProvider.callMethod
): Promise<void> {
    try {
        await callMethod('logging.fn_report_worker_observation_add', {
            p_queued_count: snapshot.queuedCount,
            p_report_processing_count: snapshot.processingCount,
            p_worker_occupied_count: snapshot.workerOccupiedCount,
            p_worker_capacity: tuning.delivery.outboxConcurrency,
            p_oldest_queued_age_ms: Math.max(
                0,
                Math.round(snapshot.oldestQueuedAgeMs)
            )
        });
    } catch {
        Observability.incrementCounter('report_performance_persist_errors');
    }
}

export async function persistPdfRenderObservation(
    observation: PdfRenderObservation,
    callMethod: CallMethod = PostgresProvider.callMethod
): Promise<void> {
    try {
        await callMethod('logging.fn_report_pdf_observation_add', {
            p_duration_ms: Math.max(0, Math.round(observation.durationMs)),
            p_budget_ms: tuning.report.pdfRenderBudgetMs,
            p_complex_rows: Math.max(0, Math.floor(observation.complexRows)),
            p_failed: observation.failed
        });
    } catch {
        Observability.incrementCounter('report_performance_persist_errors');
        try {
            await callMethod('logging.fn_report_pdf_persist_failure_add', {});
        } catch {
            // A database-wide outage also makes the worker heartbeat stale,
            // which is independently alerting. Keep the in-process counter
            // for Prometheus and avoid failing the completed report artifact.
        }
    }
}
