import {tuning} from '../../config';
import {
    type CsvArtifactWriter,
    type CsvMeta,
    createCsvArtifactWriter,
    writeHtmlAndReturnMeta
} from '../../modules/csvExport';
import type CommandSender from '../CommandSender';
import {downloadUrlFor} from '../energy/exportHandler';
import type {EnergyReportRow} from './energyEngineHelpers';
import {
    bindReportArtifactOwner,
    reportCsvArtifactFormat,
    type ScopeResult
} from './engineHelpers';
import {renderEnergyReportHtml} from './renderEnergyReportHtml';
import type {ReportJobContext} from './reportJobContext';

type ReportRow = Record<string, any>;

export interface EnergyReportArtifactOpenRequest {
    sender: CommandSender;
    schemaVersion: number;
    shellyIDs: string[];
    scope: ScopeResult;
    from: string;
    to: string;
    granularity: string;
    context?: ReportJobContext;
}

export interface EnergyReportArtifactFinishRequest {
    fromLabel: string;
    toLabel: string;
    currency: string;
    totalConsumptionKWh: number;
    totalReturnedKWh: number;
    totalCost: number;
    phaseRowCount: number;
    tariffMode: string;
    touShiftSavings: number;
    carbonKgCO2: number;
    dataQualityOverall: number;
    anomalyCount: number;
    recommendationCount: number;
    // Data-driven sections that rendered (ids); appended to the sections meta.
    extraSections: string[];
}

export interface EnergyReportArtifactResult {
    csvMeta: CsvMeta;
    responseMeta: CsvMeta & {html_file: string};
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
    const rows = new StreamingEnergyRows({
        csvWriter,
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
                rows
            }),
        fail: (error) => csvWriter.destroy(error)
    };
}

async function finishEnergyReportArtifacts(input: {
    openRequest: EnergyReportArtifactOpenRequest;
    finishRequest: EnergyReportArtifactFinishRequest;
    safeName: string;
    csvWriter: CsvArtifactWriter;
    rows: StreamingEnergyRows;
}): Promise<EnergyReportArtifactResult> {
    await input.rows.waitForWrites();
    const request = {
        ...input.openRequest,
        ...input.finishRequest,
        rowCount: input.rows.length
    };
    const csvMeta = await input.csvWriter.close(buildEnergyCsvMeta(request));
    const htmlMeta = await writeEnergyHtmlArtifact({
        request,
        safeName: input.safeName,
        csvMeta,
        rows: input.rows.summaryRows
    });
    return {
        csvMeta,
        responseMeta: {...csvMeta, html_file: htmlMeta.file}
    };
}

async function reserveEnergyReportArtifactNames(
    request: EnergyReportArtifactOpenRequest
): Promise<string> {
    return bindReportArtifactOwner({
        name: `energy_report_${request.granularity}_${Date.now()}`,
        sender: request.sender,
        extension: reportCsvArtifactFormat(),
        companionExtensions: ['html']
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
        total_consumption_kwh: +request.totalConsumptionKWh.toFixed(3),
        total_returned_kwh: +request.totalReturnedKWh.toFixed(3),
        total_cost: +request.totalCost.toFixed(2),
        sections: [...energyReportSections(request), ...request.extraSections],
        rows: request.rowCount,
        anomalies: request.anomalyCount
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
    private readonly maxSummaryRows: number;
    private readonly context?: ReportJobContext;
    private readonly retainedRows: EnergyReportRow[] = [];
    private rowCount = 0;
    private writeChain: Promise<void> = Promise.resolve();

    constructor(input: {
        csvWriter: CsvArtifactWriter;
        maxSummaryRows: number;
        context?: ReportJobContext;
    }) {
        this.csvWriter = input.csvWriter;
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
        this.writeChain = this.writeChain.then(() => this.csvWriter.write(row));
        await this.writeChain;
        await this.updateProgressIfNeeded();
    }

    async waitForWrites(): Promise<void> {
        await this.writeChain;
    }

    private append(row: ReportRow): void {
        this.capture(row);
        this.writeChain = this.writeChain.then(() => this.csvWriter.write(row));
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
        await this.context.update({
            currentPhase: 'writing',
            estimatedRows: this.context.estimatedRows,
            rowsWritten: this.rowCount,
            bytesWritten: this.csvWriter.bytesWritten(),
            percent: progressPercent(this.rowCount, this.context.estimatedRows)
        });
        await this.context.throwIfCancelled();
    }
}

function progressPercent(
    rowsWritten: number,
    estimatedRows: number | undefined
): number | undefined {
    if (!estimatedRows || estimatedRows <= 0) return undefined;
    return Math.min(99, Math.floor((rowsWritten / estimatedRows) * 100));
}
