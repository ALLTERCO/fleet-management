/**
 * Pure handler for `Sensor.Query` — the numeric twin of `Sensor.Events`.
 *
 * Mirrors `Energy.Query`'s environmental fan-out (queryHandler.handleEnergyQuery):
 * resolve the scope once, fan out one `device_sensor.fn_numeric_history` call per
 * requested kind, merge, cap, and paginate. Scope + permission resolution is
 * REUSED from the energy handler (`resolveScope`) rather than re-implemented — it
 * is the shared scope resolver for every scoped read, so authz keeps one home.
 * The numeric read itself goes through SensorRepository (source-filtered), not
 * EnergyRepository.
 *
 * Takes the structural `SenderCapabilities` (not CommandSender) and both repos by
 * injection so a unit test passes fakes without the config / plugin graph —
 * same reasoning as the energy and events handlers.
 */

import {tuning} from '../../config/tuning';
import type {EnergyRepository} from '../../modules/repositories/EnergyRepository';
import type {
    SensorNumericRow,
    SensorRepository
} from '../../modules/repositories/SensorRepository';
import {runBoundedParallel} from '../../modules/util/runBoundedParallel';
import RpcError from '../../rpc/RpcError';
import {MAX_RANGE, parseDateRange} from '../../rpc/validation';
import type {EnergyBucket} from '../../types/api/energy';
import type {
    SensorQueryParams,
    SensorQueryResponse,
    SensorQueryRow
} from '../../types/api/sensor';
import {
    resolveScope,
    type SenderCapabilities,
    senderCanCrossOrganizations
} from '../energy/queryHandler';

// Same OOM ceiling as Energy.Query — one shared row cap for both time-series
// reads. The merged fan-out is rejected past it rather than OOM the process.
const SENSOR_QUERY_ROW_LIMIT = tuning.energy.queryRowLimit;

// The rollup is 15-minute grain; 1 hour keeps sensor charts readable without
// coarsening — the same default Energy.Query's env branch uses.
const DEFAULT_BUCKET: EnergyBucket = '1 hour';

// User-facing fan-out: fail a slow kind fast, and bound TimescaleDB parallelism.
const SENSOR_QUERY_CONCURRENCY = 4;
const SENSOR_QUERY_PER_TASK_TIMEOUT_MS = 60_000;

type Scope = {
    internalIds: readonly number[];
    idMap: Readonly<Record<number, string>>;
};

export async function handleSensorQuery(
    params: SensorQueryParams,
    sender: SenderCapabilities,
    scopeRepo: EnergyRepository,
    sensorRepo: SensorRepository
): Promise<SensorQueryResponse> {
    // Mutual exclusion: the schema can't express it with Draft 7.
    if (params.scope !== undefined && params.devices !== undefined) {
        throw RpcError.InvalidParams(
            'scope and devices are mutually exclusive'
        );
    }

    // Forever rollup → same 1-year range cap as Energy.Query's env read.
    const {from, to} = parseDateRange(params.from, params.to, MAX_RANGE.YEAR);
    const bucket: EnergyBucket = params.bucket ?? DEFAULT_BUCKET;
    const paginated = params.limit !== undefined;
    const limit = params.limit ?? SENSOR_QUERY_ROW_LIMIT;
    const offset = params.offset ?? 0;

    const scope = await resolveScope(sender, params, scopeRepo);
    if (scope.internalIds.length === 0) {
        return emptyResponse(from, to, bucket, limit, offset);
    }

    const organizationId = senderCanCrossOrganizations(sender)
        ? null
        : (sender.getOrganizationId() ?? null);
    const source = params.source ?? null;
    const startMs = Date.now();

    const tasks = params.kinds.map(
        (kind) => () =>
            queryKindRows(sensorRepo, scope, {
                organizationId,
                kind,
                source,
                from,
                to,
                bucket
            })
    );
    const settled = await runBoundedParallel({
        tasks,
        run: (task) => task(),
        concurrency: SENSOR_QUERY_CONCURRENCY,
        perTaskTimeoutMs: SENSOR_QUERY_PER_TASK_TIMEOUT_MS,
        label: 'sensor-query',
        failFast: true
    });
    const allRows = settled
        .filter(
            (r): r is PromiseFulfilledResult<SensorQueryRow[]> =>
                r.status === 'fulfilled'
        )
        .flatMap((r) => r.value);
    const executionMs = Date.now() - startMs;

    const materialized = allRows.length;
    if (materialized > SENSOR_QUERY_ROW_LIMIT) {
        throw rowsExceeded(materialized);
    }
    const pageEnd = paginated
        ? Math.min(materialized, offset + limit)
        : materialized;
    const items = offset < materialized ? allRows.slice(offset, pageEnd) : [];
    const has_more = paginated && pageEnd < materialized;

    return {
        items,
        total: offset + items.length + (has_more ? 1 : 0),
        limit,
        offset,
        has_more,
        meta: {
            from: from.toISOString(),
            to: to.toISOString(),
            bucket,
            executionMs
        }
    };
}

async function queryKindRows(
    sensorRepo: SensorRepository,
    scope: Scope,
    opts: {
        organizationId: string | null;
        kind: string;
        source: string | null;
        from: Date;
        to: Date;
        bucket: EnergyBucket;
    }
): Promise<SensorQueryRow[]> {
    const rows = await sensorRepo.queryNumeric({
        organizationId: opts.organizationId,
        internalIds: scope.internalIds,
        kind: opts.kind,
        source: opts.source,
        from: opts.from,
        to: opts.to,
        bucket: opts.bucket,
        // +1 detects overflow; the merged cap is enforced after the fan-out.
        limit: SENSOR_QUERY_ROW_LIMIT + 1
    });
    return rows.map((r) => toRow(opts.kind, r, scope.idMap));
}

// fn_numeric_history is called per kind, so the row's kind is the loop's kind.
function toRow(
    kind: string,
    r: SensorNumericRow,
    idMap: Readonly<Record<number, string>>
): SensorQueryRow {
    return {
        bucket: toIso(r.bucket),
        device: r.device_id,
        shellyID: idMap[r.device_id] ?? null,
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

function emptyResponse(
    from: Date,
    to: Date,
    bucket: EnergyBucket,
    limit: number,
    offset: number
): SensorQueryResponse {
    return {
        items: [],
        total: 0,
        limit,
        offset,
        has_more: false,
        meta: {
            from: from.toISOString(),
            to: to.toISOString(),
            bucket,
            executionMs: 0
        }
    };
}

function rowsExceeded(rowCount: number): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message: `Result too large (${rowCount} rows). Use a coarser bucket or shorter range.`,
        field: 'range',
        details: {rowCount, limit: SENSOR_QUERY_ROW_LIMIT}
    });
}
