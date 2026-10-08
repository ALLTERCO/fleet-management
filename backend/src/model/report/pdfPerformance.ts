import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import * as Observability from '../../modules/Observability';
import {persistPdfRenderObservation} from '../../modules/reportPerformanceObservations';

const logger = getLogger('pdfPerformance');

const COMPLEX_PDF_TEXT =
    /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Thai}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}]/u;

export interface PdfRenderObservation {
    durationMs: number;
    complexRows: number;
    failed: boolean;
}

export function pdfTextNeedsComplexRendering(value: string): boolean {
    return COMPLEX_PDF_TEXT.test(value);
}

export function beginPdfRender(): () => void {
    Observability.setGauge(
        'report_pdf_renders_active',
        Observability.getGauge('report_pdf_renders_active') + 1
    );
    let finished = false;
    return () => {
        if (finished) return;
        finished = true;
        Observability.setGauge(
            'report_pdf_renders_active',
            Math.max(0, Observability.getGauge('report_pdf_renders_active') - 1)
        );
    };
}

export function recordPdfRender(observation: PdfRenderObservation): void {
    const durationMs = Math.max(0, Math.round(observation.durationMs));
    const complexRows = Math.max(0, Math.floor(observation.complexRows));
    Observability.setGauge('report_pdf_last_render_duration_ms', durationMs);
    Observability.setGauge('report_pdf_last_complex_rows', complexRows);
    Observability.incrementCounter(
        'report_pdf_render_duration_ms_total',
        durationMs
    );
    Observability.incrementCounter('report_pdf_render_samples_total');
    if (complexRows > 0) {
        Observability.incrementCounter('report_pdf_complex_documents_total');
        Observability.incrementCounter(
            'report_pdf_complex_rows_total',
            complexRows
        );
    }
    if (observation.failed) {
        Observability.incrementCounter('report_pdf_render_failures_total');
    }
    void persistPdfRenderObservation(observation);
    if (durationMs <= tuning.report.pdfRenderBudgetMs) return;
    Observability.incrementCounter('report_pdf_render_budget_exceeded_total');
    logger.warn(
        'PDF render exceeded performance budget: duration=%dms budget=%dms complexRows=%d failed=%s',
        durationMs,
        tuning.report.pdfRenderBudgetMs,
        complexRows,
        observation.failed
    );
}
