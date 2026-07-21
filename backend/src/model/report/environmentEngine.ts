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
    reportCsvArtifactFormat
} from './engineHelpers';
import {
    buildEnvironmentReportData,
    type EnvironmentReportData
} from './environmentReportData';
import {renderEnvironmentReportHtml} from './renderEnvironmentReportHtml';
import {writeReportGeneratedAudit} from './reportAudit';
import type {ReportJobContext} from './reportJobContext';

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
    emitReportProgress(progressOrgId, {
        kind: 'environment',
        jobId: context?.jobId,
        phase: 'started'
    });
    await context?.throwIfCancelled();

    const data = await buildEnvironmentReportData({params, sender});
    await context?.update({currentPhase: 'computing', percent: 40});
    await context?.throwIfCancelled();

    emitReportProgress(progressOrgId, {
        kind: 'environment',
        jobId: context?.jobId,
        phase: 'writing'
    });
    const artifacts = await writeEnvironmentReportArtifacts({sender, data});
    await writeReportGeneratedAudit(sender, {
        reportType: 'environment',
        rows: data.rowCount,
        meta: artifacts.csvMeta,
        generateStart
    });
    await context?.update({
        currentPhase: 'ready',
        rowsWritten: data.rowCount,
        bytesWritten: artifacts.csvMeta.size,
        percent: 100
    });
    emitReportProgress(progressOrgId, {
        kind: 'environment',
        jobId: context?.jobId,
        phase: 'done',
        durationMs: Date.now() - generateStart
    });
    return artifacts.responseMeta;
}

interface EnvironmentArtifactResult {
    csvMeta: Awaited<ReturnType<typeof writeCsv>>;
    responseMeta: Awaited<ReturnType<typeof writeCsv>> & {html_file: string};
}

async function writeEnvironmentReportArtifacts(input: {
    sender: CommandSender;
    data: EnvironmentReportData;
}): Promise<EnvironmentArtifactResult> {
    // Bind owner before write so a Redis failure leaves no orphan artifact; the
    // .html companion is owner-bound too so the summary download is gated.
    const safeName = await bindReportArtifactOwner({
        name: `environment_report_${input.data.granularity}_${Date.now()}`,
        sender: input.sender,
        extension: reportCsvArtifactFormat(),
        companionExtensions: ['html']
    });
    const csvMeta = await writeCsv(safeName, input.data);
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
    return {csvMeta, responseMeta: {...csvMeta, html_file: htmlMeta.file}};
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
