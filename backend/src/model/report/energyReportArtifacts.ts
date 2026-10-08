import {tuning} from '../../config';
import {
    type CsvArtifactWriter,
    type CsvMeta,
    createCsvArtifactWriter,
    writeHtmlAndReturnMeta
} from '../../modules/csvExport';
import {roundCurrencyAmount} from '../../types/api/_currency.js';
import type {CarbonCalculateResponse} from '../../types/api/carbon.js';
import type {
    ReportCoverageInterval,
    ReportMeasuredUsageCost
} from '../../types/api/report.js';
import type CommandSender from '../CommandSender';
import {downloadUrlFor} from '../energy/exportHandler';
import type {EnergyReportRow} from './energyEngineHelpers';
import {
    bindReportArtifactOwner,
    reportCsvArtifactFormat,
    rollbackReportArtifacts,
    type ScopeResult
} from './engineHelpers';
import type {GasConversionDisclosure} from './gasConversion.js';
import {createPdfArtifactWriter, type PdfArtifactWriter} from './pdfArtifact';
import {renderPdfInWorker} from './pdfRenderHost';
import {renderEnergyReportHtml} from './renderEnergyReportHtml';
import {
    type ReportJobContext,
    reportArtifactHooks,
    reportWritingProgress
} from './reportJobContext';
import {roundReportTotalKWh} from './rowEconomics';
import {
    createXlsxArtifactWriter,
    type XlsxArtifactWriter
} from './xlsxArtifact';

type ReportRow = Record<string, any>;

export interface EnergyReportArtifactOpenRequest {
    sender: CommandSender;
    schemaVersion: number;
    shellyIDs: string[];
    scope: ScopeResult;
    from: string;
    to: string;
    granularity: string;
    /** The organization's region (BCP-47), resolved once by the caller and
     *  used for every person-facing figure the artifacts write. */
    locale: string;
    format?: 'csv' | 'html' | 'xlsx' | 'pdf';
    context?: ReportJobContext;
}

export interface EnergyReportArtifactFinishRequest {
    fromLabel: string;
    toLabel: string;
    currency: string;
    totalConsumptionKWh: number;
    totalReturnedKWh: number;
    totalCost: number;
    measuredUsageCost: ReportMeasuredUsageCost;
    coverage: ReportCoverageInterval;
    phaseRowCount: number;
    tariffMode: string;
    touShiftSavings: number;
    carbonKgCO2: number;
    dataQualityOverall: number;
    anomalyCount: number;
    recommendationCount: number;
    calculationVersion: string;
    tariffSnapshot: Record<string, unknown>;
    emissionFactors?: {
        locationBasedGPerKWh: number;
        marketBasedGPerKWh: number | null;
    };
    carbonAccounting?: {
        primary: CarbonCalculateResponse | null;
        marketBased: CarbonCalculateResponse | null;
    };
    gasConversions?: readonly GasConversionDisclosure[];
    // Data-driven sections that rendered (ids); appended to the sections meta.
    extraSections: string[];
}

export interface EnergyReportArtifactResult {
    csvMeta: CsvMeta;
    primaryMeta: CsvMeta;
    responseMeta: CsvMeta & {
        csv_file: string;
        html_file: string;
        xlsx_file?: string;
        pdf_file?: string;
        coverage: ReportCoverageInterval;
        measured_usage_cost: ReportMeasuredUsageCost;
    };
}

export interface EnergyReportArtifactSession {
    readonly rows: ReportRow[];
    finish(
        request: EnergyReportArtifactFinishRequest
    ): Promise<EnergyReportArtifactResult>;
    fail(error: Error): void;
}

export async function openEnergyReportArtifacts(
    request: EnergyReportArtifactOpenRequest
): Promise<EnergyReportArtifactSession> {
    const safeName = await reserveEnergyReportArtifactNames(request);
    const csvWriter = createCsvArtifactWriter({
        name: safeName,
        format: reportCsvArtifactFormat()
    });
    let xlsxWriter: XlsxArtifactWriter | undefined;
    let pdfWriter: PdfArtifactWriter | undefined;
    try {
        xlsxWriter =
            request.format === 'xlsx'
                ? await createXlsxArtifactWriter(safeName)
                : undefined;
        pdfWriter =
            request.format === 'pdf'
                ? await createPdfArtifactWriter({
                      render: renderPdfInWorker,
                      ...reportArtifactHooks(request.context),
                      name: safeName,
                      title: 'Energy Report',
                      subtitle: `${request.from} - ${request.to} | ${request.shellyIDs.length} devices | ${request.granularity}`,
                      locale: request.locale
                  })
                : undefined;
    } catch (error) {
        csvWriter.destroy(error as Error);
        await rollbackEnergyArtifacts(safeName, request);
        throw error;
    }
    const rows = new StreamingEnergyRows({
        csvWriter,
        xlsxWriter,
        pdfWriter,
        maxSummaryRows: tuning.report.htmlSummaryMaxRows,
        context: request.context
    });
    return {
        rows: rows as unknown as ReportRow[],
        finish: (finishRequest) =>
            finishEnergyReportArtifacts({
                openRequest: request,
                finishRequest,
                safeName,
                csvWriter,
                xlsxWriter,
                pdfWriter,
                rows
            }),
        fail: (error) => {
            csvWriter.destroy(error);
            xlsxWriter?.destroy(error);
            pdfWriter?.destroy(error);
            void rollbackEnergyArtifacts(safeName, request);
        }
    };
}

async function finishEnergyReportArtifacts(input: {
    openRequest: EnergyReportArtifactOpenRequest;
    finishRequest: EnergyReportArtifactFinishRequest;
    safeName: string;
    csvWriter: CsvArtifactWriter;
    xlsxWriter?: XlsxArtifactWriter;
    pdfWriter?: PdfArtifactWriter;
    rows: StreamingEnergyRows;
}): Promise<EnergyReportArtifactResult> {
    try {
        await input.rows.waitForWrites();
        // Cancel is still free here: nothing has reached disk yet.
        await input.openRequest.context?.throwIfCancelled();
        const request = {
            ...input.openRequest,
            ...input.finishRequest,
            rowCount: input.rows.length
        };
        const meta = buildEnergyCsvMeta(request);
        const csvMeta = await input.csvWriter.close(meta);
        const xlsxMeta = input.xlsxWriter
            ? await input.xlsxWriter.close(meta)
            : null;
        const pdfMeta = input.pdfWriter
            ? await input.pdfWriter.close(meta)
            : null;
        await input.openRequest.context?.throwIfCancelled();
        const htmlMeta = await writeEnergyHtmlArtifact({
            request,
            safeName: input.safeName,
            csvMeta,
            rows: input.rows.summaryRows
        });
        return {
            csvMeta,
            primaryMeta: pdfMeta ?? xlsxMeta ?? csvMeta,
            responseMeta: {
                ...(pdfMeta ?? xlsxMeta ?? csvMeta),
                csv_file: csvMeta.file,
                html_file: htmlMeta.file,
                coverage: input.finishRequest.coverage,
                measured_usage_cost: input.finishRequest.measuredUsageCost,
                ...(xlsxMeta ? {xlsx_file: xlsxMeta.file} : {}),
                ...(pdfMeta ? {pdf_file: pdfMeta.file} : {})
            }
        };
    } catch (error) {
        input.xlsxWriter?.destroy(error as Error);
        input.pdfWriter?.destroy(error as Error);
        await rollbackEnergyArtifacts(input.safeName, input.openRequest);
        throw error;
    }
}

function energyArtifactExtensions(
    request: Pick<EnergyReportArtifactOpenRequest, 'format'>
): string[] {
    return [
        reportCsvArtifactFormat(),
        'html',
        ...(request.format === 'xlsx' ? ['xlsx'] : []),
        ...(request.format === 'pdf' ? ['pdf'] : [])
    ];
}

async function rollbackEnergyArtifacts(
    safeName: string,
    request: Pick<EnergyReportArtifactOpenRequest, 'format'>
): Promise<void> {
    await rollbackReportArtifacts(safeName, energyArtifactExtensions(request));
}

async function reserveEnergyReportArtifactNames(
    request: EnergyReportArtifactOpenRequest
): Promise<string> {
    return bindReportArtifactOwner({
        name: `energy_report_${request.granularity}_${Date.now()}`,
        sender: request.sender,
        extension: reportCsvArtifactFormat(),
        companionExtensions: [
            'html',
            ...(request.format === 'xlsx' ? ['xlsx'] : []),
            ...(request.format === 'pdf' ? ['pdf'] : [])
        ]
    });
}

function buildEnergyCsvMeta(
    request: EnergyReportArtifactOpenRequest &
        EnergyReportArtifactFinishRequest & {rowCount: number}
): Record<string, unknown> {
    return {
        schema_version: request.schemaVersion,
        devices: request.shellyIDs,
        originalDeviceCount: request.scope.originalDeviceCount,
        droppedDeviceCount: request.scope.droppedDeviceCount,
        droppedShellyIDs: request.scope.droppedShellyIDs,
        from: request.from,
        to: request.to,
        granularity: request.granularity,
        currency: request.currency,
        total_consumption_kwh: roundReportTotalKWh(request.totalConsumptionKWh),
        total_returned_kwh: roundReportTotalKWh(request.totalReturnedKWh),
        total_cost: roundCurrencyAmount(request.totalCost, request.currency),
        measured_usage_cost: request.measuredUsageCost,
        coverage: request.coverage,
        sections: [...energyReportSections(request), ...request.extraSections],
        rows: request.rowCount,
        anomalies: request.anomalyCount,
        calculation_version: request.calculationVersion,
        tariff_snapshot: request.tariffSnapshot,
        ...(request.emissionFactors
            ? {emission_factors_g_per_kwh: request.emissionFactors}
            : {}),
        ...(request.carbonAccounting
            ? {carbon_accounting: request.carbonAccounting}
            : {}),
        gas_conversion: request.gasConversions ?? []
    };
}

export function energyReportSections(
    request: Pick<
        EnergyReportArtifactFinishRequest,
        | 'phaseRowCount'
        | 'tariffMode'
        | 'touShiftSavings'
        | 'carbonKgCO2'
        | 'dataQualityOverall'
        | 'anomalyCount'
        | 'recommendationCount'
    >
): string[] {
    return [
        'header',
        'summary',
        'top_consumers',
        'time_series',
        request.phaseRowCount > 0 ? 'phase_analysis' : null,
        request.tariffMode !== 'single' ? 'cost_analysis' : null,
        request.touShiftSavings > 0 ? 'opportunity' : null,
        request.carbonKgCO2 > 0 ? 'carbon' : null,
        request.dataQualityOverall < 0.9 ? 'data_quality' : null,
        request.anomalyCount > 0 ? 'anomalies' : null,
        request.recommendationCount > 0 ? 'recommendations' : null
    ].filter((section): section is string => section !== null);
}

async function writeEnergyHtmlArtifact(input: {
    request: EnergyReportArtifactOpenRequest &
        EnergyReportArtifactFinishRequest & {rowCount: number};
    safeName: string;
    csvMeta: CsvMeta;
    rows: readonly EnergyReportRow[];
}): Promise<CsvMeta> {
    const html = renderEnergyReportHtml(input.rows, {
        title: 'Energy Report',
        subtitle: `${input.request.fromLabel} – ${input.request.toLabel} · ${input.request.shellyIDs.length} devices · ${input.request.granularity}`,
        coverage:
            input.request.coverage.status === 'partial'
                ? input.request.coverage
                : undefined,
        generatedAt: input.csvMeta.generated,
        dataDownloadUrl: downloadUrlFor(input.csvMeta.file),
        rowsShown: input.rows.length,
        totalRows: input.request.rowCount
    });
    return writeHtmlAndReturnMeta(html, input.safeName, {
        schema_version: input.request.schemaVersion
    });
}

class StreamingEnergyRows {
    private readonly csvWriter: CsvArtifactWriter;
    private readonly xlsxWriter?: XlsxArtifactWriter;
    private readonly pdfWriter?: PdfArtifactWriter;
    private readonly maxSummaryRows: number;
    private readonly context?: ReportJobContext;
    private readonly retainedRows: EnergyReportRow[] = [];
    private rowCount = 0;
    private writeChain: Promise<void> = Promise.resolve();

    constructor(input: {
        csvWriter: CsvArtifactWriter;
        xlsxWriter?: XlsxArtifactWriter;
        pdfWriter?: PdfArtifactWriter;
        maxSummaryRows: number;
        context?: ReportJobContext;
    }) {
        this.csvWriter = input.csvWriter;
        this.xlsxWriter = input.xlsxWriter;
        this.pdfWriter = input.pdfWriter;
        this.maxSummaryRows = input.maxSummaryRows;
        this.context = input.context;
    }

    get length(): number {
        return this.rowCount;
    }

    get summaryRows(): readonly EnergyReportRow[] {
        return this.retainedRows;
    }

    push(...rows: ReportRow[]): number {
        for (const row of rows) this.append(row);
        return this.rowCount;
    }

    async write(row: ReportRow): Promise<void> {
        this.capture(row);
        this.writeChain = this.writeChain.then(async () => {
            await this.csvWriter.write(row);
            await this.xlsxWriter?.write(row);
            await this.pdfWriter?.write(row);
        });
        await this.writeChain;
        await this.updateProgressIfNeeded();
    }

    async waitForWrites(): Promise<void> {
        await this.writeChain;
    }

    private append(row: ReportRow): void {
        this.capture(row);
        this.writeChain = this.writeChain.then(async () => {
            await this.csvWriter.write(row);
            await this.xlsxWriter?.write(row);
            await this.pdfWriter?.write(row);
        });
    }

    private capture(row: ReportRow): void {
        this.rowCount += 1;
        if (this.retainedRows.length < this.maxSummaryRows) {
            this.retainedRows.push(row as EnergyReportRow);
        }
    }

    private async updateProgressIfNeeded(): Promise<void> {
        if (!this.context) return;
        if (this.rowCount % tuning.report.streamChunkRows !== 0) return;
        await reportWritingProgress(this.context, {
            rowsWritten: this.rowCount,
            bytesWritten:
                this.csvWriter.bytesWritten() +
                (this.xlsxWriter?.bytesWritten() ?? 0) +
                (this.pdfWriter?.bytesWritten() ?? 0)
        });
        await this.context.throwIfCancelled();
    }
}
