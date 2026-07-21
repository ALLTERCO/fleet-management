// Data layer for the environment report. Resolves the caller's scope and window
// (mirroring buildEnergyReportData's guards: org, dashboard ownership, scope
// read, device map), reads the 15-minute sensor rollup the dashboard uses
// (device_sensor.fn_numeric_history via SensorRepository — one fan-out per
// kind, source-filtered), then hands the readings to the pure composer for the
// section-tagged rows. Sourcing readings here (not through Sensor.Query) keeps
// the report self-contained the same way the energy report reads its repos
// directly.

import {getLogger} from 'log4js';
import {tuning} from '../../config';
import {GRANULARITY_MAP} from '../../config/energy';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {
    defaultSensorRepository,
    type SensorEventsRow,
    type SensorNumericRow,
    type SensorRepository
} from '../../modules/repositories/SensorRepository';
import {runBoundedParallel} from '../../modules/util/runBoundedParallel';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import type {ReportGenerateEnvironmentParams} from '../../types/api/report';
import type {SensorQueryRow} from '../../types/api/sensor';
import type CommandSender from '../CommandSender';
import {
    assertDashboardOwnedBySender,
    reportTimezoneFor,
    resolveScopeOnlyForEnergyReport
} from './energyEngineHelpers';
import {
    assertExactlyOneRange,
    deviceDisplayName,
    type ScopeResult,
    scopeShellyIDs
} from './engineHelpers';
import type {EnvironmentReportRow} from './environmentReportRow';
import {composeEnvironmentReportRows} from './environmentReportSections';
import {
    ENVIRONMENT_REPORT_KINDS,
    type EnvironmentEvent,
    type EnvironmentReading
} from './environmentReportStats';
import {resolveReportPeriod} from './reportPeriod';

const logger = getLogger('environmentReportData');

// Same OOM ceiling as Sensor.Query — one shared row cap for the sensor fan-out.
const MAX_READINGS = tuning.energy.queryRowLimit;

// Fail a slow kind fast and bound TimescaleDB parallelism — same knobs as the
// Sensor.Query handler.
const KIND_QUERY_CONCURRENCY = 4;
const KIND_QUERY_TIMEOUT_MS = 60_000;

export interface EnvironmentReportData {
    rows: EnvironmentReportRow[];
    scope: ScopeResult;
    shellyIDs: string[];
    sensorCount: number;
    fromDate: Date;
    toDate: Date;
    fromLabel: string;
    toLabel: string;
    granularity: string;
    bucket: string;
    rowCount: number;
}

interface BuildEnvironmentReportDataRequest {
    params: ReportGenerateEnvironmentParams;
    sender: CommandSender;
}

export async function buildEnvironmentReportData(
    request: BuildEnvironmentReportDataRequest
): Promise<EnvironmentReportData> {
    assertExactlyOneRange(request.params);
    const orgId = requireOrganizationId(request.sender, {
        organizationId: (request.params as {organizationId?: string})
            .organizationId
    });
    // Gate first — dashboard settings carry no org column, so a crafted id could
    // otherwise read another tenant's report configuration.
    await assertDashboardOwnedBySender(
        request.params.dashboardId,
        request.sender,
        orgId
    );
    const timezone = await reportTimezoneFor(orgId, request.params.timezone);
    // An explicit device allowlist (the dashboard's on-screen filter) wins over
    // scope; either way the devices are access-filtered before any data is read.
    const {shellyIDs, scope} = request.params.devices?.length
        ? await resolveDeviceAllowlist(request.params.devices, request.sender)
        : await resolveScopeOnlyForEnergyReport(
              request.params.scope,
              request.sender,
              orgId
          );
    const {internalIds, deviceMap} = await resolveDeviceMap(shellyIDs);
    const range = envReportRange(request.params, timezone);
    const bucket = envReportBucket(request.params);

    const readings = await readEnvironmentReadings({
        orgId,
        internalIds,
        deviceMap,
        source: request.params.source ?? null,
        from: range.fromDate,
        to: range.toDate,
        bucket
    });
    const events = await readEnvironmentEvents({
        orgId,
        internalIds,
        deviceMap,
        from: range.fromDate,
        to: range.toDate
    });

    const rows = composeEnvironmentReportRows({
        readings,
        events,
        from: range.fromDate,
        to: range.toDate,
        bucket,
        sensorCount: shellyIDs.length,
        sectionsEnabled: request.params.sections_enabled,
        sensorLabel: ({device, shellyID}) =>
            device > 0 ? deviceDisplayName(device, deviceMap) : (shellyID ?? '')
    });

    return {
        rows,
        scope,
        shellyIDs,
        sensorCount: shellyIDs.length,
        fromDate: range.fromDate,
        toDate: range.toDate,
        fromLabel: range.fromLabel,
        toLabel: range.toLabel,
        granularity: request.params.granularity ?? 'hour',
        bucket,
        rowCount: rows.length
    };
}

// Access-filter a caller-supplied device list (mirrors the scope path's
// filtering) so a spoofed shellyID can never read another tenant's sensors.
async function resolveDeviceAllowlist(
    devices: readonly string[],
    sender: CommandSender
): Promise<{shellyIDs: string[]; scope: ScopeResult}> {
    const scope = await scopeShellyIDs([...devices], sender);
    return {shellyIDs: scope.shellyIDs, scope};
}

async function resolveDeviceMap(
    shellyIDs: readonly string[]
): Promise<{internalIds: number[]; deviceMap: Map<number, string>}> {
    const {internalIds, idMap} = await PostgresProvider.resolveDeviceIds([
        ...shellyIDs
    ]);
    if (!internalIds.length) throw RpcError.NotFound('device_ids');
    return {
        internalIds,
        deviceMap: new Map(Object.entries(idMap).map(([k, v]) => [+k, v]))
    };
}

interface EnvironmentReportRange {
    fromDate: Date;
    toDate: Date;
    fromLabel: string;
    toLabel: string;
}

// Resolve the report window: a named `period` (tz-aware, server-resolved) wins,
// else the explicit from/to. Same rule as the energy report.
function envReportRange(
    params: ReportGenerateEnvironmentParams,
    timezone: string | null
): EnvironmentReportRange {
    const {fromDate, toDate} = params.period
        ? resolvedPeriodRange(params, timezone)
        : {
              fromDate: new Date(params.from ?? ''),
              toDate: new Date(params.to ?? '')
          };
    if (
        !Number.isFinite(fromDate.getTime()) ||
        !Number.isFinite(toDate.getTime())
    ) {
        throw RpcError.InvalidParams('from/to must be ISO timestamps');
    }
    if (toDate.getTime() <= fromDate.getTime()) {
        throw RpcError.InvalidParams('to must be after from');
    }
    return {
        fromDate,
        toDate,
        fromLabel: utcDateLabel(fromDate),
        toLabel: utcDateLabel(toDate)
    };
}

function resolvedPeriodRange(
    params: ReportGenerateEnvironmentParams,
    timezone: string | null
): {fromDate: Date; toDate: Date} {
    if (!params.period) throw RpcError.InvalidParams('period is required');
    const {from, to} = resolveReportPeriod(
        params.period,
        new Date(),
        timezone,
        {
            billingDay: params.billing_day
        }
    );
    return {fromDate: from, toDate: to};
}

function utcDateLabel(value: Date): string {
    return `${value.toISOString().slice(0, 10)} UTC`;
}

// Bucket for the sensor read. Defaults to hourly — readable without coarsening
// the forever 15-minute rollup, matching Sensor.Query's default granularity.
function envReportBucket(params: ReportGenerateEnvironmentParams): string {
    const bucket = GRANULARITY_MAP[params.granularity ?? 'hour'];
    if (!bucket) throw RpcError.InvalidParams('Invalid granularity');
    return bucket;
}

interface ReadEnvironmentReadingsRequest {
    orgId: string | null;
    internalIds: readonly number[];
    deviceMap: Map<number, string>;
    source: string | null;
    from: Date;
    to: Date;
    bucket: string;
}

// One fn_numeric_history read per kind, bounded and fail-fast: a DB error on any
// kind fails the report loudly rather than dropping a silent partial section.
async function readEnvironmentReadings(
    req: ReadEnvironmentReadingsRequest
): Promise<EnvironmentReading[]> {
    if (req.internalIds.length === 0) return [];
    const repo = await defaultSensorRepository();
    const tasks = ENVIRONMENT_REPORT_KINDS.map(
        (kind) => () => queryKind(repo, kind, req)
    );
    const settled = await runBoundedParallel({
        tasks,
        run: (task) => task(),
        concurrency: KIND_QUERY_CONCURRENCY,
        perTaskTimeoutMs: KIND_QUERY_TIMEOUT_MS,
        label: 'environment-report',
        failFast: true
    });
    const rows = settled
        .filter(
            (r): r is PromiseFulfilledResult<EnvironmentReading[]> =>
                r.status === 'fulfilled'
        )
        .flatMap((r) => r.value);
    if (rows.length > MAX_READINGS) {
        logger.warn(
            'environment report readings %d exceed cap %d',
            rows.length,
            MAX_READINGS
        );
        throw RpcError.Domain('ValidationFailed', {
            message: `Result too large (${rows.length} readings). Use a coarser granularity or shorter range.`,
            field: 'range',
            details: {rowCount: rows.length, limit: MAX_READINGS}
        });
    }
    return rows;
}

async function queryKind(
    repo: SensorRepository,
    kind: string,
    req: ReadEnvironmentReadingsRequest
): Promise<EnvironmentReading[]> {
    const rows = await repo.queryNumeric({
        organizationId: req.orgId,
        internalIds: req.internalIds,
        kind,
        source: req.source,
        from: req.from,
        to: req.to,
        bucket: req.bucket,
        // +1 detects overflow; the merged cap is enforced after the fan-out.
        limit: MAX_READINGS + 1
    });
    return (
        rows
            .map((r) => toReading(kind, r, req.deviceMap))
            // Environment = ambient. Drop chip temps (source='internal') unless
            // the caller asked for that source explicitly — matches the dashboard.
            .filter((r) => req.source != null || r.source !== 'internal')
    );
}

// Discrete events for the presence + safety sections. One fn_events_query read
// (all kinds), newest-first, bounded and fail-loud like the numeric fan-out — a
// silent truncation would undercount activity and miss the latest safety state.
async function readEnvironmentEvents(req: {
    orgId: string | null;
    internalIds: readonly number[];
    deviceMap: Map<number, string>;
    from: Date;
    to: Date;
}): Promise<EnvironmentEvent[]> {
    if (req.internalIds.length === 0) return [];
    const repo = await defaultSensorRepository();
    const rows = await repo.queryEvents({
        organizationId: req.orgId,
        internalIds: req.internalIds,
        kind: null,
        from: req.from,
        to: req.to,
        // +1 detects overflow; a truncated event set would silently mislead.
        limit: MAX_READINGS + 1
    });
    if (rows.length > MAX_READINGS) {
        logger.warn(
            'environment report events %d exceed cap %d',
            rows.length,
            MAX_READINGS
        );
        throw RpcError.Domain('ValidationFailed', {
            message: `Result too large (${rows.length} events). Use a shorter range.`,
            field: 'range',
            details: {rowCount: rows.length, limit: MAX_READINGS}
        });
    }
    return rows.map((r) => toEvent(r, req.deviceMap));
}

function toEvent(
    r: SensorEventsRow,
    deviceMap: Map<number, string>
): EnvironmentEvent {
    return {
        ts: toIso(r.ts),
        device: r.device_id,
        shellyID: deviceMap.get(r.device_id) ?? null,
        kind: r.kind,
        state: r.state,
        source: r.source
    };
}

// fn_numeric_history is called per kind, so the reading's kind is the loop kind.
function toReading(
    kind: string,
    r: SensorNumericRow,
    deviceMap: Map<number, string>
): SensorQueryRow {
    return {
        bucket: toIso(r.bucket),
        device: r.device_id,
        shellyID: deviceMap.get(r.device_id) ?? null,
        kind,
        source: r.source,
        channel: r.channel,
        sampleCount: toNum(r.sample_count),
        value: toNum(r.avg_value),
        min: r.min_value == null ? null : toNum(r.min_value),
        max: r.max_value == null ? null : toNum(r.max_value)
    };
}

function toIso(bucket: unknown): string {
    if (bucket instanceof Date) return bucket.toISOString();
    if (typeof bucket === 'string') return bucket;
    return String(bucket);
}

function toNum(v: unknown): number {
    return typeof v === 'number' ? v : Number(v ?? 0);
}
