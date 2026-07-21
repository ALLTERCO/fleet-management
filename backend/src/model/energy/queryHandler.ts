/**
 * Pure handler for `Energy.Query`.
 *
 * Extracted from `EnergyComponent` so unit tests can exercise the logic
 * without importing the Component base class (which drags config /
 * plugin init into the module graph). The component method becomes a
 * one-line adapter.
 *
 * The handler takes a minimal `SenderCapabilities` interface rather than
 * `CommandSender` so callers can pass a structurally-typed fake in
 * tests without importing the full CommandSender class.
 */

import {classifyTags, ENV_ROLLUP_FIELD} from '../../config/energy';
// Direct from leaf — config/index.ts barrel breaks tests that DI a fake repo.
import {tuning} from '../../config/tuning';
import {requireScopeRead} from '../../modules/authz/evaluator/scopeRead';
import type {EnergyRepository} from '../../modules/repositories/EnergyRepository';
import {runBoundedParallel} from '../../modules/util/runBoundedParallel';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {MAX_RANGE, parseDateRange} from '../../rpc/validation';
import {
    ENERGY_QUERY_PARAMS_SCHEMA,
    type EnergyBucket,
    type EnergyQueryParams,
    type EnergyQueryResponse,
    type EnergyQueryRow,
    type EnergyQueryTag
} from '../../types/api/energy';
import {scopeId, scopeKind} from '../../types/api/fleet';

const ENERGY_QUERY_ROW_LIMIT = tuning.energy.queryRowLimit;

// --- Scaling ----------------------------------------------------------

/**
 * Per-tag divisor applied to raw DB values to reach display units.
 * Unlisted tags use divisor 1.
 */
const TAG_DIVISOR: Readonly<Record<string, number>> = Object.freeze({
    total_act_energy: 1000, // Wh → kWh
    total_act_ret_energy: 1000 // Wh → kWh
});

function scale(tag: string, rawValue: unknown): number {
    const n = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0);
    const divisor = TAG_DIVISOR[tag] ?? 1;
    return divisor === 1 ? n : n / divisor;
}

function toIso(bucket: unknown): string {
    if (bucket instanceof Date) return bucket.toISOString();
    if (typeof bucket === 'string') return bucket;
    return String(bucket);
}

// --- Sender contract --------------------------------------------------

/**
 * The subset of `CommandSender` that the Energy.Query handler needs.
 * Declared as a structural interface so tests can pass a plain object.
 */
export interface SenderCapabilities {
    isAdmin(): boolean;
    canCrossOrganizations?(): boolean;
    getAllowedIdsForComponent(component: string): Array<string | number> | null;
    filterAccessibleDevices(ids: string[]): Promise<Set<string>>;
    /**
     * Organization scope for group-keyed queries. Required when `groupId`
     * is in the request since groups live under `organization.groups`
     * post-slice-E.
     */
    getOrganizationId(): string | undefined;
    /** Owner identity for export-bind. Undefined for unauthenticated paths. */
    getUserId?(): string | undefined;
}

export function senderCanCrossOrganizations(
    sender: SenderCapabilities
): boolean {
    return sender.canCrossOrganizations?.() ?? false;
}

// --- Handler ----------------------------------------------------------

// `totals` only shapes a grouped response; without groupBy it is a silent
// no-op, so reject it. Shared by both query paths so the rule has one home.
export function assertQueryModifiers(params: EnergyQueryParams): void {
    if (params.totals !== undefined && params.groupBy === undefined) {
        throw RpcError.InvalidParams('totals requires groupBy');
    }
}

export async function handleEnergyQuery(
    params: unknown,
    sender: SenderCapabilities,
    repo: EnergyRepository
): Promise<EnergyQueryResponse> {
    const validated = validateOrThrow<EnergyQueryParams>(
        params,
        ENERGY_QUERY_PARAMS_SCHEMA
    );

    // Mutual exclusion: the schema can't express it with Draft 7.
    if (validated.scope !== undefined && validated.devices !== undefined) {
        throw RpcError.InvalidParams(
            'scope and devices are mutually exclusive'
        );
    }
    assertQueryModifiers(validated);

    const {energyTags, envTags, unknownTags} = classifyTags(validated.tags);
    if (unknownTags.length > 0) {
        throw RpcError.InvalidParams(
            `unknown tag(s): ${unknownTags.join(', ')}`
        );
    }

    // Env history now reads the forever rollup, so it shares the 1-year cap.
    const maxRangeMs = MAX_RANGE.YEAR;
    const {from, to} = parseDateRange(validated.from, validated.to, maxRangeMs);

    const bucket: EnergyBucket = validated.bucket ?? '1 day';
    // No default filter. Omitted commodity/source return every domain, each
    // already its own row (the DB fn groups by domain), so nothing is hidden
    // and AC/DC never mix in one value. A caller narrows by passing a filter.
    const commodity = validated.commodity;
    const electricalSource = validated.electricalSource;
    const perDevice = validated.perDevice ?? true;
    const perPhase = validated.perPhase ?? false;
    const paginated = validated.limit !== undefined;
    const limit = validated.limit ?? ENERGY_QUERY_ROW_LIMIT;
    const offset = validated.offset ?? 0;

    const scope = await resolveScope(sender, validated, repo);
    if (scope.internalIds.length === 0) {
        return emptyResponse(from, to, bucket, limit, offset);
    }

    const startMs = Date.now();

    if (energyTags.length > 0 && envTags.length === 0) {
        // +1 detects overflow without a count query.
        const dbLimit = paginated ? limit + 1 : ENERGY_QUERY_ROW_LIMIT + 1;
        const page = await queryEnergyRows(
            repo,
            scope,
            from,
            to,
            energyTags,
            bucket,
            commodity,
            electricalSource,
            perDevice,
            perPhase,
            {limit: dbLimit, offset}
        );
        const executionMs = Date.now() - startMs;
        if (!paginated && page.length > ENERGY_QUERY_ROW_LIMIT) {
            throw rowsExceeded(page.length);
        }
        const has_more = paginated && page.length > limit;
        const items = has_more ? page.slice(0, limit) : page;
        return pagedResponse(items, {
            limit,
            offset,
            has_more,
            from,
            to,
            bucket,
            executionMs
        });
    }

    type EnergyQueryTask = () => Promise<EnergyQueryRow[]>;
    const tasks: EnergyQueryTask[] = [];

    if (energyTags.length > 0) {
        tasks.push(() =>
            queryEnergyRows(
                repo,
                scope,
                from,
                to,
                energyTags,
                bucket,
                commodity,
                electricalSource,
                perDevice,
                perPhase,
                {limit: ENERGY_QUERY_ROW_LIMIT + 1, offset: 0}
            )
        );
    }
    // Env sent no bucket historically (the old DB fn hardcoded 1h); keep 1h as
    // the env default so charts do not coarsen, but honor an explicit bucket.
    const envBucket: EnergyBucket = validated.bucket ?? '1 hour';
    for (const envTag of envTags) {
        tasks.push(() =>
            queryEnvRows(
                repo,
                scope,
                envTag,
                from,
                to,
                envBucket,
                senderCanCrossOrganizations(sender)
                    ? null
                    : (sender.getOrganizationId() ?? null),
                ENERGY_QUERY_ROW_LIMIT + 1
            )
        );
    }

    // User-facing path: surface a slow query's failure without waiting on
    // the rest of the fan-out. Cap parallelism to keep TimescaleDB sane.
    const ENERGY_QUERY_CONCURRENCY = 4;
    const ENERGY_QUERY_PER_TASK_TIMEOUT_MS = 60_000;
    const settled = await runBoundedParallel({
        tasks,
        run: (task) => task(),
        concurrency: ENERGY_QUERY_CONCURRENCY,
        perTaskTimeoutMs: ENERGY_QUERY_PER_TASK_TIMEOUT_MS,
        label: 'energy-query',
        failFast: true
    });
    const allRows = settled
        .filter(
            (r): r is PromiseFulfilledResult<EnergyQueryRow[]> =>
                r.status === 'fulfilled'
        )
        .flatMap((r) => r.value);
    const executionMs = Date.now() - startMs;

    const materialized = allRows.length;
    if (materialized > ENERGY_QUERY_ROW_LIMIT) {
        throw rowsExceeded(materialized);
    }
    const pageEnd = paginated
        ? Math.min(materialized, offset + limit)
        : materialized;
    const items = offset < materialized ? allRows.slice(offset, pageEnd) : [];
    const has_more = paginated && pageEnd < materialized;

    return pagedResponse(items, {
        limit,
        offset,
        has_more,
        from,
        to,
        bucket,
        executionMs
    });
}

function rowsExceeded(rowCount: number): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message: `Result too large (${rowCount} rows). Use a coarser bucket or shorter range.`,
        field: 'range',
        details: {rowCount, limit: ENERGY_QUERY_ROW_LIMIT}
    });
}

export interface PageMeta {
    limit: number;
    offset: number;
    has_more: boolean;
    from: Date;
    to: Date;
    bucket: EnergyBucket;
    executionMs: number;
    // Exact row count when the caller materialized the full set (meter
    // queries). Omit for DB-paged reads, where total is a lower bound.
    total?: number;
}

// total is exact when provided, else a lower bound; has_more is the
// authoritative more-data signal.
export function pagedResponse(
    items: EnergyQueryRow[],
    meta: PageMeta
): EnergyQueryResponse {
    return {
        items,
        total:
            meta.total ?? meta.offset + items.length + (meta.has_more ? 1 : 0),
        limit: meta.limit,
        offset: meta.offset,
        has_more: meta.has_more,
        meta: {
            from: meta.from.toISOString(),
            to: meta.to.toISOString(),
            bucket: meta.bucket,
            executionMs: meta.executionMs
        }
    };
}

// --- Internals --------------------------------------------------------

// The scope/device selector shared by every Energy.* method — resolveScope
// only ever reads these two, so live reads (Energy.Current) reuse the same
// authz + resolution instead of re-implementing it.
export type ScopeSelector = Pick<EnergyQueryParams, 'scope' | 'devices'>;

export async function resolveScope(
    sender: SenderCapabilities,
    validated: ScopeSelector,
    repo: EnergyRepository
): Promise<{
    internalIds: readonly number[];
    idMap: Readonly<Record<number, string>>;
}> {
    if (validated.scope !== undefined) {
        const senderOrg = sender.getOrganizationId();
        if (!senderOrg) throw RpcError.Unauthorized();
        await requireScopeRead(sender, validated.scope, senderOrg, {
            resolve: (orgId, kind, id) =>
                repo.resolveScopeShellyIDs({
                    orgId,
                    scopeKind: kind,
                    scopeId: id
                })
        });
        // Group scope: resolve via existing helper, then narrow through
        // filterAccessibleDevices so partial-overlap groups don't leak
        // members the caller cannot read. location/tag/fleet routes
        // through device.fn_resolve_scope below.
        if (typeof validated.scope.groupId === 'number') {
            const {internalIds, idMap} = await repo.resolveGroupDevices(
                validated.scope.groupId,
                senderOrg
            );
            if (senderCanCrossOrganizations(sender)) {
                return {internalIds, idMap};
            }
            const accessible = await sender.filterAccessibleDevices(
                Object.values(idMap)
            );
            const filteredIds: number[] = [];
            const filteredMap: Record<number, string> = {};
            for (const intId of internalIds) {
                const sid = idMap[intId];
                if (accessible.has(sid)) {
                    filteredIds.push(intId);
                    filteredMap[intId] = sid;
                }
            }
            return {internalIds: filteredIds, idMap: filteredMap};
        }
        const shellyIDs = await repo.resolveScopeShellyIDs({
            orgId: senderOrg,
            scopeKind: scopeKind(validated.scope),
            scopeId: scopeId(validated.scope)
        });
        if (!shellyIDs.length) return {internalIds: [], idMap: {}};
        // Global provider support only bypasses tenant boundary. Tenant admins fall
        // through filterAccessibleDevices, which enforces org-scope on
        // device reads via #orgDeviceIds before the admin shortcut.
        const accessible = senderCanCrossOrganizations(sender)
            ? new Set(shellyIDs)
            : await sender.filterAccessibleDevices(shellyIDs);
        const allowed = shellyIDs.filter((id) => accessible.has(id));
        if (!allowed.length) return {internalIds: [], idMap: {}};
        return repo.resolveDevices(allowed);
    }

    if (validated.devices !== undefined) {
        const accessible = await sender.filterAccessibleDevices(
            validated.devices
        );
        const allowed = validated.devices.filter((id) => accessible.has(id));
        if (allowed.length === 0) {
            throw RpcError.Domain('PermissionDenied');
        }
        return repo.resolveDevices(allowed);
    }

    // Global provider support keeps its cross-tenant live snapshot. Tenant
    // history comes from PostgreSQL so offline devices remain queryable.
    const canCrossOrganizations = senderCanCrossOrganizations(sender);
    if (canCrossOrganizations) return repo.resolveFleetDevices();

    if (!canReadDashboardCollection(sender)) {
        throw RpcError.Domain('PermissionDenied');
    }
    const senderOrg = sender.getOrganizationId();
    if (!senderOrg) throw RpcError.Unauthorized();

    const shellyIDs = await repo.resolveScopeShellyIDs({
        orgId: senderOrg,
        scopeKind: 'fleet',
        scopeId: null
    });
    if (!shellyIDs.length) return {internalIds: [], idMap: {}};
    const accessible = await sender.filterAccessibleDevices(shellyIDs);
    const allowed = shellyIDs.filter((id) => accessible.has(id));
    if (!allowed.length) return {internalIds: [], idMap: {}};
    return repo.resolveDevices(allowed);
}

function canReadDashboardCollection(sender: SenderCapabilities): boolean {
    const ids = sender.getAllowedIdsForComponent('dashboards');
    return ids === null || ids.length > 0;
}

function emptyResponse(
    from: Date,
    to: Date,
    bucket: EnergyBucket,
    limit: number,
    offset: number
): EnergyQueryResponse {
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

async function queryEnergyRows(
    repo: EnergyRepository,
    scope: {
        internalIds: readonly number[];
        idMap: Readonly<Record<number, string>>;
    },
    from: Date,
    to: Date,
    tags: string[],
    bucket: string,
    commodity: string | undefined,
    electricalSource: string | undefined,
    perDevice: boolean,
    perPhase: boolean,
    page: {limit: number; offset: number}
): Promise<EnergyQueryRow[]> {
    const opts = {
        internalIds: scope.internalIds,
        from,
        to,
        tags,
        bucket,
        commodity,
        electricalSource,
        perDevice,
        limit: page.limit,
        offset: page.offset
    };

    if (perPhase) {
        const rows = await repo.queryEnergyStatsByPhase(opts);
        return rows.map((r) => ({
            bucket: toIso(r.bucket),
            device: r.device,
            shellyID: scope.idMap[r.device] ?? null,
            tag: r.tag as EnergyQueryTag,
            domain: r.domain ?? 'unspecified',
            value: scale(r.tag, r.agg_value),
            phase: r.phase
        }));
    }

    const rows = await repo.queryEnergyStats(opts);
    return rows.map((r) => ({
        bucket: toIso(r.bucket),
        device: r.device,
        shellyID: scope.idMap[r.device] ?? null,
        tag: r.tag as EnergyQueryTag,
        domain: r.domain ?? 'unspecified',
        value: scale(r.tag, r.agg_value)
    }));
}

async function queryEnvRows(
    repo: EnergyRepository,
    scope: {
        internalIds: readonly number[];
        idMap: Readonly<Record<number, string>>;
    },
    envTag: string,
    from: Date,
    to: Date,
    bucket: string,
    organizationId: string | null,
    dbLimit: number
): Promise<EnergyQueryRow[]> {
    const field = ENV_ROLLUP_FIELD[envTag];
    if (!field) {
        // Defensive — classifyTags already vetted this. Surface the
        // tag loudly if it ever leaks past.
        throw RpcError.InvalidParams(`no env rollup field for tag ${envTag}`);
    }
    const rows = await repo.queryEnvironmental({
        organizationId,
        internalIds: scope.internalIds,
        field,
        from,
        to,
        bucket,
        limit: dbLimit
    });
    return rows.map((r) => ({
        bucket: toIso(r.bucket),
        device: r.device_id,
        shellyID: scope.idMap[r.device_id] ?? null,
        tag: envTag as EnergyQueryTag,
        // device_sensor readings carry no electrical domain — 'unspecified'
        // satisfies the shared row shape.
        domain: 'unspecified',
        value: Number(r.avg_value ?? 0),
        min: r.min_value == null ? null : Number(r.min_value),
        max: r.max_value == null ? null : Number(r.max_value),
        source: r.source
    }));
}
