// CSV/HTML export for the environment report — the twin of generateEnergyReport.
// Validates params, builds the section-tagged rows from the sensor rollup, writes
// the .csv(.gz) data file and the branded .html summary, audits, and returns the
// artifact meta the job flow turns into owner-bound download URLs.
//
// The row set is bounded (one summary/breakdown row per kind and per sensor), so
// unlike the energy engine this writes rows in one pass — no streaming needed.

import {canCrossOrganizationBoundary} from '../../modules/authz/evaluator';
import {
    createCsvArtifactWriter,
    writeHtmlAndReturnMeta
} from '../../modules/csvExport';
import {emitReportProgress} from '../../modules/EventDistributor';
import {buildFormatterContext} from '../../modules/i18n/formatterContext';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    REPORT_GENERATE_ENVIRONMENT_PARAMS_SCHEMA,
    type ReportGenerateEnvironmentParams
} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {downloadUrlFor} from '../energy/exportHandler';
import {
    assertValidReportTimezone,
    bindReportArtifactOwner,
    reportCsvArtifactFormat,
    rollbackReportArtifacts
} from './engineHelpers';
import {
    buildEnvironmentReportData,
    type EnvironmentReportData
} from './environmentReportData';
import {createPdfArtifactWriter} from './pdfArtifact';
import {renderPdfInWorker} from './pdfRenderHost';
import {renderEnvironmentReportHtml} from './renderEnvironmentReportHtml';
import {writeReportGeneratedAudit} from './reportAudit';
import {
    enterReportPhase,
    type ReportJobContext,
    reportArtifactHooks
} from './reportJobContext';
import {createXlsxArtifactWriter} from './xlsxArtifact';

// Bump when the CSV columns change.
const ENVIRONMENT_REPORT_SCHEMA_VERSION = 1;

function reportProgressOrgId(sender: CommandSender): string | null {
    return canCrossOrganizationBoundary(sender)
        ? null
        : requireOrganizationId(sender);
}

export async function generateEnvironmentReport(
    rawParams: unknown,
    sender: CommandSender,
    context?: ReportJobContext
) {
    const generateStart = Date.now();
    const params = validateOrThrow<ReportGenerateEnvironmentParams>(
        rawParams,
        REPORT_GENERATE_ENVIRONMENT_PARAMS_SCHEMA
    );
    assertValidReportTimezone(params.timezone);
    const progressOrgId = reportProgressOrgId(sender);
    const progressUserId = context?.userId ?? sender.getUserId();
    if (progressUserId)
        emitReportProgress(progressOrgId, progressUserId, {
            kind: 'environment',
            jobId: context?.jobId,
            phase: 'started'
        });
    await context?.throwIfCancelled();

    const data = await buildEnvironmentReportData({params, sender});
    await enterReportPhase(context, 'computing');
    await context?.throwIfCancelled();

    if (progressUserId)
        emitReportProgress(progressOrgId, progressUserId, {
            kind: 'environment',
            jobId: context?.jobId,
            phase: 'writing'
        });
    await enterReportPhase(context, 'writing', {
        rowsWritten: data.rowCount
    });
    const artifacts = await writeEnvironmentReportArtifacts({
        sender,
        data,
        format: params.format,
        context
    });
    await writeReportGeneratedAudit(sender, {
        reportType: 'environment',
        rows: data.rowCount,
        meta: artifacts.primaryMeta,
        generateStart
    });
    await enterReportPhase(context, 'ready', {
        rowsWritten: data.rowCount,
        bytesWritten: artifacts.primaryMeta.size
    });
    if (progressUserId)
        emitReportProgress(progressOrgId, progressUserId, {
            kind: 'environment',
            jobId: context?.jobId,
            phase: 'done',
            durationMs: Date.now() - generateStart
        });
    return artifacts.responseMeta;
}

interface EnvironmentArtifactResult {
    csvMeta: Awaited<ReturnType<typeof writeCsv>>;
    primaryMeta: Awaited<ReturnType<typeof writeCsv>>;
    responseMeta: Awaited<ReturnType<typeof writeCsv>> & {
        csv_file: string;
        html_file: string;
        xlsx_file?: string;
        pdf_file?: string;
    };
}

async function writeEnvironmentReportArtifacts(input: {
    sender: CommandSender;
    data: EnvironmentReportData;
    format?: 'csv' | 'html' | 'xlsx' | 'pdf';
    context?: ReportJobContext;
}): Promise<EnvironmentArtifactResult> {
    // Bind owner before write so a Redis failure leaves no orphan artifact; the
    // .html companion is owner-bound too so the summary download is gated.
    const safeName = await bindReportArtifactOwner({
        name: `environment_report_${input.data.granularity}_${Date.now()}`,
        sender: input.sender,
        extension: reportCsvArtifactFormat(),
        companionExtensions: [
            'html',
            ...(input.format === 'xlsx' ? ['xlsx'] : []),
            ...(input.format === 'pdf' ? ['pdf'] : [])
        ]
    });
    try {
        const csvMeta = await writeCsv(safeName, input.data);
        const xlsxMeta =
            input.format === 'xlsx'
                ? await writeXlsx(safeName, input.data)
                : null;
        const pdfMeta =
            input.format === 'pdf'
                ? await writePdf(
                      safeName,
                      input.data,
                      input.sender,
                      input.context
                  )
                : null;
        const html = renderEnvironmentReportHtml(input.data.rows, {
            title: 'Environment Report',
            subtitle: `${input.data.fromLabel} – ${input.data.toLabel} · ${input.data.sensorCount} sensors · ${input.data.granularity}`,
            generatedAt: csvMeta.generated,
            dataDownloadUrl: downloadUrlFor(csvMeta.file),
            rowsShown: input.data.rowCount,
            totalRows: input.data.rowCount
        });
        const htmlMeta = await writeHtmlAndReturnMeta(html, safeName, {
            schema_version: ENVIRONMENT_REPORT_SCHEMA_VERSION
        });
        return {
            csvMeta,
            primaryMeta: pdfMeta ?? xlsxMeta ?? csvMeta,
            responseMeta: {
                ...(pdfMeta ?? xlsxMeta ?? csvMeta),
                csv_file: csvMeta.file,
                html_file: htmlMeta.file,
                ...(xlsxMeta ? {xlsx_file: xlsxMeta.file} : {}),
                ...(pdfMeta ? {pdf_file: pdfMeta.file} : {})
            }
        };
    } catch (error) {
        await rollbackReportArtifacts(safeName, [
            reportCsvArtifactFormat(),
            'html',
            ...(input.format === 'xlsx' ? ['xlsx'] : []),
            ...(input.format === 'pdf' ? ['pdf'] : [])
        ]);
        throw error;
    }
}

async function writePdf(
    safeName: string,
    data: EnvironmentReportData,
    sender: CommandSender,
    context?: ReportJobContext
) {
    // Resolved here rather than in the caller: only the PDF branch writes a
    // person-facing count, so no other format pays for the profile read.
    const {locale} = await buildFormatterContext(sender);
    const writer = await createPdfArtifactWriter({
        render: renderPdfInWorker,
        ...reportArtifactHooks(context),
        name: safeName,
        title: 'Environment Report',
        subtitle: `${data.fromLabel} - ${data.toLabel} | ${data.sensorCount} sensors | ${data.granularity}`,
        locale
    });
    try {
        for (const row of data.rows) {
            await writer.write(row as unknown as Record<string, unknown>);
        }
        return await writer.close({
            schema_version: ENVIRONMENT_REPORT_SCHEMA_VERSION,
            devices: data.shellyIDs,
            droppedShellyIDs: data.scope.droppedShellyIDs,
            from: data.fromDate.toISOString(),
            to: data.toDate.toISOString(),
            granularity: data.granularity,
            sensors: data.sensorCount,
            rows: data.rowCount
        });
    } catch (error) {
        writer.destroy(error as Error);
        throw error;
    }
}

async function writeXlsx(safeName: string, data: EnvironmentReportData) {
    const writer = await createXlsxArtifactWriter(safeName);
    try {
        for (const row of data.rows) {
            await writer.write(row as unknown as Record<string, unknown>);
        }
        return await writer.close({
            schema_version: ENVIRONMENT_REPORT_SCHEMA_VERSION,
            devices: data.shellyIDs,
            droppedShellyIDs: data.scope.droppedShellyIDs,
            from: data.fromDate.toISOString(),
            to: data.toDate.toISOString(),
            granularity: data.granularity,
            sensors: data.sensorCount,
            rows: data.rowCount
        });
    } catch (error) {
        writer.destroy(error as Error);
        throw error;
    }
}

async function writeCsv(safeName: string, data: EnvironmentReportData) {
    const writer = createCsvArtifactWriter({
        name: safeName,
        format: reportCsvArtifactFormat()
    });
    try {
        // Fixed-shape rows serialize as records; the CSV header derives from them.
        for (const row of data.rows) {
            await writer.write(row as unknown as Record<string, unknown>);
        }
        return await writer.close({
            schema_version: ENVIRONMENT_REPORT_SCHEMA_VERSION,
            devices: data.shellyIDs,
            droppedShellyIDs: data.scope.droppedShellyIDs,
            from: data.fromDate.toISOString(),
            to: data.toDate.toISOString(),
            granularity: data.granularity,
            sensors: data.sensorCount,
            rows: data.rowCount
        });
    } catch (error) {
        writer.destroy(error as Error);
        throw error;
    }
}
