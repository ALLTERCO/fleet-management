// Pure helpers shared by the per-kind report engines. No `this`, no RPC concerns.

import {randomBytes} from 'node:crypto';
import {tuning} from '../../config';
import {GRANULARITY_MAP, METRIC_TYPES} from '../../config/energy';
import {canCrossOrganizationBoundary} from '../../modules/authz/evaluator';
import {requireScopeRead} from '../../modules/authz/evaluator/scopeRead';
import {
    type CsvArtifactFormat,
    sanitizeFileName
} from '../../modules/csvExport';
import * as DeviceCollector from '../../modules/DeviceCollector';
import {isValidTimezone} from '../../modules/location/isoData';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {resolveScopeShellyIDs} from '../../modules/scopeResolver';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {scopeId, scopeKind} from '../../types/api/fleet';
import type {ReportGenerateParams} from '../../types/api/report';
import type CommandSender from '../CommandSender';
import {bindExportOwner} from '../energy/exportHandler';
import {reportArtifactTtlSec} from './reportRetention';

// Re-export GRANULARITY_MAP at this module so engines have one import.
export {GRANULARITY_MAP};

// Re-export energy's metric defs — one source of truth.
export const REPORT_TYPES = METRIC_TYPES;

export interface tDeviceReport {
    device: string;
    recordDate?: string;
    totalEnergyKw?: number;
    price?: number;
    [x: string]: unknown;
}

interface ReportStatsRow {
    bucket: string;
    device: string | number;
    tag: string;
    agg_value: number;
}

export async function deviceId2DeviceName(
    rows: tDeviceReport[],
    idMap: Record<number, string>,
    nameCache: Map<number, string>
): Promise<tDeviceReport[]> {
    // Batch-fetch all uncached device names in a single query
    const uncachedShellyIDs: string[] = [];
    for (const r of rows) {
        const iid = Number(r.device);
        if (!nameCache.has(iid) && idMap[iid]) {
            uncachedShellyIDs.push(idMap[iid]);
        }
    }
    if (uncachedShellyIDs.length > 0) {
        try {
            const batchRows =
                await PostgresProvider.getBatch(uncachedShellyIDs);
            for (const row of batchRows) {
                nameCache.set(row.id, row.jdoc?.name || row.external_id);
            }
        } catch {
            // Fallback: use shellyIDs as names
            for (const r of rows) {
                const iid = Number(r.device);
                if (!nameCache.has(iid)) {
                    nameCache.set(iid, idMap[iid] || String(iid));
                }
            }
        }
    }

    return rows.map((r) => {
        const iid = Number(r.device);
        const name = nameCache.get(iid) || idMap[iid] || String(iid);
        return {...r, device: name};
    });
}

export interface ScopeResult {
    /** ShellyIDs the caller is allowed to see — feed these to the report. */
    shellyIDs: string[];
    /** Original ShellyID count before scope narrowing. */
    originalDeviceCount: number;
    /** Devices in the config that the caller cannot see; 0 for admin. */
    droppedDeviceCount: number;
    /** ShellyIDs dropped (stable order) so callers can annotate the CSV. */
    droppedShellyIDs: string[];
}

// Global provider support passes through; others flow through filterAccessibleDevices.
export async function scopeShellyIDs(
    shellyIDs: string[],
    sender: CommandSender
): Promise<ScopeResult> {
    if (canCrossOrganizationBoundary(sender)) {
        return {
            shellyIDs,
            originalDeviceCount: shellyIDs.length,
            droppedDeviceCount: 0,
            droppedShellyIDs: []
        };
    }
    const accessible = await sender.filterAccessibleDevices(shellyIDs);
    const allowed: string[] = [];
    const dropped: string[] = [];
    for (const id of shellyIDs) {
        if (accessible.has(id)) allowed.push(id);
        else dropped.push(id);
    }
    if (allowed.length === 0) {
        throw RpcError.Unauthorized();
    }
    return {
        shellyIDs: allowed,
        originalDeviceCount: shellyIDs.length,
        droppedDeviceCount: dropped.length,
        droppedShellyIDs: dropped
    };
}

// ── Energy-report helpers ────────────────────────────────────────────
// Pure sub-steps of generateEnergyReport() — no `this`, no closures.

/** internalId → name → shellyID → stringified id. */
export function deviceDisplayName(
    deviceId: number,
    deviceMap: Map<number, string>
): string {
    const shellyId = deviceMap.get(deviceId);
    if (!shellyId) return String(deviceId);
    const dev = DeviceCollector.getDevice(shellyId);
    return (dev?.info?.name as string) || shellyId;
}

/** Classifies device from status: 3ph_em/em/mono_em/pm/switch/unknown. */
export function deviceHardwareType(
    deviceId: number,
    deviceMap: Map<number, string>
): string {
    const shellyId = deviceMap.get(deviceId);
    if (!shellyId) return 'unknown';
    const dev = DeviceCollector.getDevice(shellyId);
    const status = dev?.status || {};
    if ('em:1' in status) return '3ph_em';
    for (let i = 0; i < 5; i++) {
        if (status[`em:${i}`]) return 'em';
        if (status[`em1:${i}`]) return 'mono_em';
        if (status[`pm1:${i}`]) return 'pm';
    }
    if (status['switch:0']) return 'switch';
    return 'unknown';
}

// Anomaly types & detectors live in '../report/anomalies' — pure module.

// ─────────────────────────────────────────────────────────────────────
// Shared engine helpers — previously class-private methods on
// ReportComponent. Promoted here because each is a pure function over
// inputs (no `this`, no closures) called by multiple engines.
// ─────────────────────────────────────────────────────────────────────

export function validateReportRequest(
    metrics: string[],
    granularity: string,
    params: ReportGenerateParams
): {reportDefs: (typeof REPORT_TYPES)[string][]; bucket: string} {
    const reportDefs = metrics.map((metric) => {
        const reportDef = REPORT_TYPES[metric];
        if (!reportDef) {
            throw RpcError.InvalidParams(
                `Invalid metric "${metric}". Valid metrics: ${Object.keys(REPORT_TYPES).join(', ')}`
            );
        }
        return reportDef;
    });
    const bucket = GRANULARITY_MAP[granularity];
    if (!bucket) {
        throw RpcError.InvalidParams(
            `Invalid granularity "${granularity}". Valid options: ${Object.keys(GRANULARITY_MAP).join(', ')}`
        );
    }
    const inputModes = [
        params.scope !== undefined && params.scope !== null,
        Array.isArray(params.devices) && params.devices.length > 0
    ].filter(Boolean).length;
    if (inputModes !== 1) {
        throw RpcError.InvalidParams(
            'Exactly one of scope, devices is required'
        );
    }
    assertExactlyOneRange(params);
    return {reportDefs, bucket};
}

// A junk zone would silently fall back to UTC and misbill day/night and tariff
// windows — reject it at the report boundary. An absent zone is a defined
// default (org tz, then UTC), so only an explicit value is checked.
export function assertValidReportTimezone(timezone: string | undefined): void {
    if (
        typeof timezone === 'string' &&
        timezone !== '' &&
        !isValidTimezone(timezone)
    ) {
        throw RpcError.InvalidParams(
            `timezone '${timezone}' is not a valid IANA zone`
        );
    }
}

// A report's window is given exactly one way: a named `period` (resolved
// server-side in the org tz) OR an explicit from+to. Both, or neither, is
// ambiguous — fail loud rather than silently picking one.
export function assertExactlyOneRange(params: {
    period?: string;
    from?: string;
    to?: string;
}): void {
    const hasPeriod = typeof params.period === 'string' && params.period !== '';
    const hasRange = !!params.from && !!params.to;
    if (hasPeriod === hasRange) {
        throw RpcError.InvalidParams(
            'Provide exactly one of: period, or from + to'
        );
    }
}

export async function resolveScopeForGenerate(
    params: ReportGenerateParams,
    sender: CommandSender
): Promise<{shellyIDs: string[]; scope: ScopeResult}> {
    if (Array.isArray(params.devices) && params.devices.length > 0) {
        const scope = await scopeShellyIDs(params.devices, sender);
        if (!scope.shellyIDs.length) {
            throw RpcError.Domain('ValidationFailed', {
                message: 'No devices in scope for this report',
                field: 'devices'
            });
        }
        return {shellyIDs: scope.shellyIDs, scope};
    }
    const orgId = requireOrganizationId(sender, {
        organizationId: (params as {organizationId?: string}).organizationId
    });
    await requireScopeRead(sender, params.scope, orgId, {
        resolve: resolveScopeShellyIDs
    });
    const rawShellyIDs = await resolveScopeShellyIDs(
        orgId,
        scopeKind(params.scope),
        scopeId(params.scope)
    );
    if (!rawShellyIDs.length) {
        throw RpcError.Domain('ValidationFailed', {
            message: 'No devices in scope for this report',
            field: 'devices'
        });
    }
    const scope = await scopeShellyIDs(rawShellyIDs, sender);
    return {shellyIDs: scope.shellyIDs, scope};
}

export async function fetchAndCheckReportStats(
    internalIds: number[],
    params: ReportGenerateParams,
    reportDef: (typeof REPORT_TYPES)[string],
    bucket: string
): Promise<{rows: ReportStatsRow[]}> {
    const rep = await PostgresProvider.callMethod(
        'device_em.fn_report_stats_paged',
        {
            p_devices: internalIds,
            p_from: new Date(params.from),
            p_to: new Date(params.to),
            p_tags: reportDef.tags,
            p_bucket: bucket,
            p_per_device: params.per_device !== false,
            // AC-mains electricity report; other commodities/sources are explicit.
            p_commodity: 'electricity',
            p_electrical_source: 'ac_mains',
            p_limit: tuning.report.maxRows + 1,
            p_offset: 0
        }
    );
    if (rep.rows.length > tuning.report.maxRows) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Result too large (${rep.rows.length} rows). Use a coarser granularity or shorter date range.`,
            field: 'range',
            details: {
                rowCount: rep.rows.length,
                limit: tuning.report.maxRows
            }
        });
    }
    return rep;
}

export async function warmReportNameCache(
    idMap: Record<number, string>,
    perDevice: boolean | undefined
): Promise<Map<number, string>> {
    const nameCache = new Map<number, string>();
    if (perDevice === false) return nameCache;
    await deviceId2DeviceName([], idMap, nameCache);
    const uncachedShellyIDs: string[] = [];
    for (const iid of Object.keys(idMap).map(Number)) {
        if (!nameCache.has(iid) && idMap[iid]) {
            uncachedShellyIDs.push(idMap[iid]);
        }
    }
    if (uncachedShellyIDs.length === 0) return nameCache;
    try {
        const batchRows = await PostgresProvider.getBatch(uncachedShellyIDs);
        for (const row of batchRows) {
            nameCache.set(row.id, row.jdoc?.name || row.external_id);
        }
    } catch {
        // Fallback: row generator uses shellyID as the name.
    }
    return nameCache;
}

// Org id for emitted events: null for provider-support callers (they
// cross orgs), the caller's org otherwise. Shared by every engine.
export function eventOrgId(sender: CommandSender): string | null {
    return canCrossOrganizationBoundary(sender)
        ? null
        : requireOrganizationId(sender);
}

// Bind owner before write so a Redis failure leaves no orphan artifact.
// Returns the sanitized filename without its artifact extension.
export async function bindOwnerBeforeWrite(
    name: string,
    sender: CommandSender
): Promise<string> {
    return bindReportArtifactOwner({
        name,
        sender,
        extension: 'csv'
    });
}

export interface ReportArtifactOwnerRequest {
    name: string;
    sender: CommandSender;
    extension: CsvArtifactFormat;
    companionExtensions?: readonly string[];
}

export async function bindReportArtifactOwner(
    request: ReportArtifactOwnerRequest
): Promise<string> {
    // Random suffix so two tenants generating the same report in the
    // same millisecond can't collide on a shared filename.
    const safeName = sanitizeFileName(
        `${request.name}_${randomBytes(4).toString('hex')}`
    );
    await bindExportOwner(
        `${safeName}.${request.extension}`,
        request.sender.getUserId(),
        reportArtifactTtlSec()
    );
    for (const extension of request.companionExtensions ?? []) {
        await bindExportOwner(
            `${safeName}.${extension}`,
            request.sender.getUserId(),
            reportArtifactTtlSec()
        );
    }
    return safeName;
}

export function reportCsvArtifactFormat(): CsvArtifactFormat {
    return tuning.report.gzipCsvArtifacts ? 'csv.gz' : 'csv';
}
