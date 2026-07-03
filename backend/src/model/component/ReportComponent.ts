/**
 * Report namespace — owns the Report.* RPC surface and its export pipeline.
 *
 * Exposed methods: Describe, Generate (unified front door, async),
 * GetReport, Cancel, SuggestTimeShift, PurgeReports.
 *
 * Owns the report-specific helpers (CSV writer, filename sanitizer,
 * device-name cache, tariff / imbalance tables).
 *
 * Permissions: `mapLegacyComponentName('report')` returns null, so every
 * method carries an explicit decorator (`@Component.CrudPermission` for
 * all non-Purge methods, `@Component.CheckPermissions`
 * for admin-only PurgeReports). All report-generating methods filter the
 * config's shellyID list through `scopeShellyIDs(sender)` before running,
 * so a non-admin only dumps devices their CRUD scope allows.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {tuning} from '../../config';
import {canCrossOrganizationBoundary} from '../../modules/authz/evaluator';
import {UPLOADS_DIR as PLUGIN_UPLOADS} from '../../modules/csvExport';
import * as PostgresProvider from '../../modules/PostgresProvider';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    REPORT_CANCEL_PARAMS_SCHEMA,
    REPORT_DESCRIBE,
    REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA,
    REPORT_GET_REPORT_PARAMS_SCHEMA,
    REPORT_PURGE_PARAMS_SCHEMA,
    REPORT_SUGGEST_TIME_SHIFT_PARAMS_SCHEMA,
    type ReportGenerateParams,
    type ReportGenerateUnifiedParams,
    type ReportSuggestTimeShiftParams,
    type ReportSuggestTimeShiftResponse
} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {cancelExportJob, getExportJob} from '../energy/exportJobStore';
import {fetchDashboardCarbonContext} from '../report/dashboardCarbonContext';
import {resolveScopeForGenerate} from '../report/engineHelpers';
import {startReportJob} from '../report/reportJobService';
import {suggestTimeShift} from '../report/suggestTimeShift';
import Component from './Component';

// Local `resolveDeviceIds` removed in Phase 7: report methods now call
// `PostgresProvider.resolveDeviceIds` directly. Same shape, same DB
// batch fetch — one source of truth for this mapping.
//
// Device-name cache is per-call (a fresh `Map` allocated at the top of
// each report handler) — earlier a shared module-level LRU caused
// concurrent reports to race: report A's `clear()` would wipe entries
// report B had just batched, forcing B into the shellyID-as-name
// fallback and corrupting B's CSV. Per-call Maps eliminate the race and
// have no growth pressure because each handler also throws on
// >2M-row results well before a name cache would matter.

export default class ReportComponent extends Component {
    constructor() {
        super('report', {set_config_methods: false, auto_apply_config: false});
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return REPORT_DESCRIBE;
    }

    // THE unified report endpoint. Returns a jobId immediately and runs the
    // report off the request path; the result (or failure) lands in the job
    // record, which the caller reads via GetReport. `kind` selects the report.
    @Component.Expose('Generate')
    @Component.CrudPermission('reports', 'update')
    @Component.RateLimit('expensive')
    async generate(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<ReportGenerateUnifiedParams>(
            rawParams,
            REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA
        );
        return startReportJob(params, sender);
    }

    // Fetch a report started by Generate. Owner-checked: a caller only sees
    // their own jobs. Returns the download URL once the file is ready.
    @Component.Expose('GetReport')
    @Component.CrudPermission('reports', 'update')
    async getReport(rawParams: unknown, sender: CommandSender) {
        const {jobId} = validateOrThrow<{jobId: string}>(
            rawParams,
            REPORT_GET_REPORT_PARAMS_SCHEMA
        );
        const job = await getExportJob(jobId);
        if (!job || job.userId !== sender.getUserId()) {
            throw RpcError.NotFound('report_job');
        }
        return {
            jobId: job.jobId,
            status: job.status,
            downloadUrl: job.downloadUrl ?? null,
            htmlUrl: job.htmlUrl ?? null,
            artifacts: job.artifacts ?? null,
            manifest: job.manifest ?? null,
            progress: job.progress ?? null,
            expiresAt: job.expiresAt ?? null,
            bytes: job.bytes ?? null,
            error: job.error ?? null
        };
    }

    @Component.Expose('Cancel')
    @Component.CrudPermission('reports', 'update')
    async cancel(rawParams: unknown, sender: CommandSender) {
        const {jobId} = validateOrThrow<{jobId: string}>(
            rawParams,
            REPORT_CANCEL_PARAMS_SCHEMA
        );
        const userId = sender.getUserId();
        if (!userId) throw RpcError.Unauthorized();
        const job = await cancelExportJob({
            jobId,
            userId
        });
        if (!job || job.userId !== userId) {
            throw RpcError.NotFound('report_job');
        }
        return {
            jobId: job.jobId,
            status: job.status
        };
    }

    @Component.Expose('SuggestTimeShift')
    @Component.CrudPermission('reports', 'read')
    async suggestTimeShift(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<ReportSuggestTimeShiftResponse> {
        const params = validateOrThrow<ReportSuggestTimeShiftParams>(
            rawParams,
            REPORT_SUGGEST_TIME_SHIFT_PARAMS_SCHEMA
        );
        const {shellyIDs} = await resolveScopeForGenerate(
            {
                ...params,
                metrics: ['consumption'],
                granularity: 'hour'
            } as ReportGenerateParams,
            sender
        );
        const {internalIds} =
            await PostgresProvider.resolveDeviceIds(shellyIDs);
        if (!internalIds.length) return {plan: null};

        const fromDate = new Date(params.from);
        const toDate = new Date(params.to);
        if (
            !Number.isFinite(fromDate.getTime()) ||
            !Number.isFinite(toDate.getTime())
        ) {
            throw RpcError.InvalidParams('from/to must be ISO timestamps');
        }
        if (toDate.getTime() <= fromDate.getTime()) {
            throw RpcError.InvalidParams('to must be after from');
        }
        const carbonContext = await fetchDashboardCarbonContext(
            params.dashboardId,
            requireOrganizationId(sender)
        );
        const plan = await suggestTimeShift({
            deviceIds: internalIds,
            from: fromDate,
            to: toDate,
            factorGPerKWh: carbonContext.lbmGPerKWh,
            maxShiftableKWh:
                params.maxShiftableKWh ?? tuning.energy.timeShiftMaxKWh,
            carbon: {
                zoneCode: tuning.electricityMaps.zone,
                apiKey: tuning.electricityMaps.apiKey,
                apiUrl: tuning.electricityMaps.url,
                timeoutMs: tuning.electricityMaps.timeoutMs
            }
        });
        return {plan};
    }

    @Component.Expose('PurgeReports')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    async purgeReports(rawParams: unknown) {
        validateOrThrow<Record<string, never>>(
            rawParams ?? {},
            REPORT_PURGE_PARAMS_SCHEMA
        );
        try {
            const fnames = await this.listPurgeableReportFiles();
            const {deletedFiles, failedFiles} =
                await this.deleteReportFiles(fnames);

            // Fail loud so the caller can retry the on-disk purge.
            if (failedFiles.length > 0) {
                throw RpcError.OperationFailed(
                    `purge reports: ${failedFiles.length} file(s) could not be deleted`
                );
            }

            return {success: true, deletedFiles, deletedDb: false};
        } catch (err) {
            if (err instanceof RpcError) throw err;
            throw RpcError.OperationFailed('purge reports', err);
        }
    }

    // .csv (formatted reports), .csv.gz (raw exports), .html (energy report
    // twin) all live in the uploads dir and all need purging.
    private async listPurgeableReportFiles(): Promise<string[]> {
        const files = await fs.readdir(PLUGIN_UPLOADS);
        return files.filter((f) => {
            const lower = f.toLowerCase();
            return (
                lower.endsWith('.csv') ||
                lower.endsWith('.csv.gz') ||
                lower.endsWith('.html')
            );
        });
    }

    private async deleteReportFiles(
        fnames: string[]
    ): Promise<{deletedFiles: number; failedFiles: string[]}> {
        const failedFiles: string[] = [];
        const results = await Promise.all(
            fnames.map((fname) => this.deleteReportFile(fname))
        );
        for (let i = 0; i < results.length; i++) {
            if (!results[i]) failedFiles.push(fnames[i]);
        }
        return {
            deletedFiles: results.filter(Boolean).length,
            failedFiles
        };
    }

    private async deleteReportFile(fname: string): Promise<boolean> {
        try {
            await fs.unlink(path.join(PLUGIN_UPLOADS, fname));
            return true;
        } catch (err) {
            // Already gone counts as deleted; only a real error blocks purge.
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
            this.logger.error(`Failed to delete report file ${fname}:`, err);
            return false;
        }
    }
}
