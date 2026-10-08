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
import {
    loadVirtualEnergyHistorySources,
    loadVirtualRoleHistorySources,
    type VirtualEnergySource,
    type VirtualRoleSource,
    type VirtualSourceOrganization,
    virtualEnergyCounterValueKWh
} from '../../modules/virtualDevice/energySources';
import {readVirtualDeviceRoleHistory} from '../../modules/virtualDevice/historyRepository';
import {filterReadableVirtualSourceMap} from '../../modules/virtualDevice/sourceAccessPolicy';
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
import {
    sensorSourceAccepted,
    UNDECLARED_ROLE_SENSOR_SOURCE
} from '../../types/api/sensor';
import {
    DEVICE_POWER_DOMAIN,
    DEVICE_POWER_TAG_PAIRS,
    devicePowerTags
} from './devicePower';
import {
    assertEnergyQueryPricingRequest,
    calculateEnergyQueryPricing,
    type EnergyQueryPricingDeps
} from './queryPricing';

const ENERGY_QUERY_ROW_LIMIT = tuning.energy.queryRowLimit;

export interface EnergyVirtualHistoryDeps {
    loadSources: typeof loadVirtualEnergyHistorySources;
    loadRoleSources?: typeof loadVirtualRoleHistorySources;
    readRoleHistory: typeof readVirtualDeviceRoleHistory;
}

const defaultVirtualHistoryDeps: EnergyVirtualHistoryDeps = {
    loadSources: loadVirtualEnergyHistorySources,
    loadRoleSources: loadVirtualRoleHistorySources,
    readRoleHistory: readVirtualDeviceRoleHistory
};

// --- Scaling ----------------------------------------------------------

/**
 * Per-tag divisor applied to raw DB values to reach display units.
 * Unlisted tags use divisor 1.
 */
const TAG_DIVISOR: Readonly<Record<string, number>> = Object.freeze({
    total_act_energy: 1000, // Wh → kWh
    total_act_ret_energy: 1000, // Wh → kWh
    fund_act_energy: 1000, // Wh → kWh
    fund_act_ret_energy: 1000, // Wh → kWh
    lag_react_energy: 1000, // VARh → kvarh
    lead_react_energy: 1000 // VARh → kvarh
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
    /** Required only when Energy.Query requests authoritative pricing. */
    hasCrudPermission?(component: 'reports', operation: 'read'): boolean;
}

export function senderCanCrossOrganizations(
    sender: Pick<SenderCapabilities, 'canCrossOrganizations'>
): boolean {
    return sender.canCrossOrganizations?.() ?? false;
}

// Custom-device bindings are tenant rows: a sender with no organization reads
// every tenant only when it may cross tenants, and is refused otherwise.
export function virtualSourceOrganization(
    organizationId: string | null | undefined,
    sender: Pick<SenderCapabilities, 'canCrossOrganizations'>
): VirtualSourceOrganization {
    if (organizationId) return organizationId;
    if (senderCanCrossOrganizations(sender)) return {crossOrganization: true};
    throw RpcError.Domain('OrgScopeRequired');
}

// --- Handler ----------------------------------------------------------

// `totals` only shapes a grouped response; without groupBy it is a silent
// no-op, so reject it. Shared by both query paths so the rule has one home.
export function assertQueryModifiers(params: EnergyQueryParams): void {
    if (params.totals !== undefined && params.groupBy === undefined) {
        throw RpcError.InvalidParams('totals requires groupBy');
    }
    if (
        params.pricing !== undefined &&
        (params.meterIds !== undefined || params.groupBy !== undefined)
    ) {
        throw RpcError.InvalidParams(
            'pricing cannot combine with meterIds or groupBy; price a device or dashboard scope'
        );
    }
}

export async function handleEnergyQuery(
    params: unknown,
    sender: SenderCapabilities,
    repo: EnergyRepository,
    pricingDeps: EnergyQueryPricingDeps = {},
    virtualDeps: EnergyVirtualHistoryDeps = defaultVirtualHistoryDeps
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
    if (validated.pricing) {
        assertEnergyQueryPricingRequest(validated, sender);
    }

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
    const withPricing = async (
        response: EnergyQueryResponse
    ): Promise<EnergyQueryResponse> => {
        if (!validated.pricing) return response;
        return {
            ...response,
            pricing: await calculateEnergyQueryPricing(
                validated,
                sender,
                repo,
                scope,
                pricingDeps
            )
        };
    };
    if (scope.internalIds.length === 0) {
        return withPricing(emptyResponse(from, to, bucket, limit, offset));
    }

    const startMs = Date.now();

    if (energyTags.length > 0 && envTags.length === 0) {
        const hasVirtualDevices = scope.internalIds.some((id) =>
            scope.idMap[id]?.startsWith('vdev_')
        );
        // Custom aliases can remove and combine physical rows. Materialize the
        // bounded logical result before applying the public page.
        const dbLimit = hasVirtualDevices
            ? paginated
                ? Math.min(ENERGY_QUERY_ROW_LIMIT + 1, offset + limit + 1)
                : ENERGY_QUERY_ROW_LIMIT + 1
            : paginated
              ? limit + 1
              : ENERGY_QUERY_ROW_LIMIT + 1;
        const dbOffset = hasVirtualDevices ? 0 : offset;
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
            sender.getOrganizationId(),
            sender,
            {limit: dbLimit, offset: dbOffset},
            virtualDeps
        );
        const executionMs = Date.now() - startMs;
        if (page.length > ENERGY_QUERY_ROW_LIMIT) {
            throw rowsExceeded(page.length);
        }
        const pageStart = hasVirtualDevices ? offset : 0;
        const pageEnd = paginated
            ? Math.min(page.length, pageStart + limit)
            : page.length;
        const has_more = paginated && pageEnd < page.length;
        const items = page.slice(pageStart, pageEnd);
        return withPricing(
            pagedResponse(items, {
                limit,
                offset,
                has_more,
                from,
                to,
                bucket,
                executionMs
            })
        );
    }

    type EnergyQueryTask = () => Promise<EnergyQueryRow[]>;
    const tasks: EnergyQueryTask[] = [];
    const logicalTaskLimit = paginated
        ? Math.min(ENERGY_QUERY_ROW_LIMIT + 1, offset + limit + 1)
        : ENERGY_QUERY_ROW_LIMIT + 1;

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
                sender.getOrganizationId(),
                sender,
                {limit: logicalTaskLimit, offset: 0},
                virtualDeps
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
                logicalTaskLimit,
                sender,
                virtualDeps
            )
        );
    }

    // User-facing path: surface a slow query's failure without waiting on
    // the rest of the fan-out. Cap parallelism to keep TimescaleDB sane.
    const ENERGY_QUERY_PER_TASK_TIMEOUT_MS = 60_000;
    const settled = await runBoundedParallel({
        tasks,
        run: (task) => task(),
        concurrency: tuning.energy.queryConcurrency,
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

    return withPricing(
        pagedResponse(items, {
            limit,
            offset,
            has_more,
            from,
            to,
            bucket,
            executionMs
        })
    );
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
    commodity: EnergyQueryParams['commodity'],
    electricalSource: EnergyQueryParams['electricalSource'],
    perDevice: boolean,
    perPhase: boolean,
    organizationId: string | undefined,
    sourceAccessSender: SenderCapabilities,
    page: {limit: number; offset: number},
    virtualDeps: EnergyVirtualHistoryDeps
): Promise<EnergyQueryRow[]> {
    const virtualIds = scope.internalIds.filter((id) =>
        scope.idMap[id]?.startsWith('vdev_')
    );
    const loadedSources =
        virtualIds.length > 0
            ? await virtualDeps.loadSources(
                  virtualSourceOrganization(organizationId, sourceAccessSender),
                  virtualIds
              )
            : new Map();
    const sources = await filterReadableVirtualSourceMap<VirtualEnergySource>(
        sourceAccessSender,
        loadedSources,
        {from, to}
    );
    const hasVirtualSources = sources.size > 0;
    // A readable custom device stays in the stats read: the database then
    // leaves out the source channels it represents, so each reading is
    // counted once under the custom device and the source keeps the rest.
    const aliasOwners = [...sources]
        .filter(([, roles]) => roles.length > 0)
        .map(([virtualId]) => virtualId);
    const baseOpts = {
        internalIds: [
            ...scope.internalIds.filter((id) => !sources.has(id)),
            ...aliasOwners
        ],
        from,
        to,
        tags,
        bucket,
        commodity,
        electricalSource,
        // Keep device attribution while custom devices are present so their
        // rows join the physical rows before an optional cross-device sum.
        perDevice: hasVirtualSources ? true : perDevice
    };
    const initialLimit = hasVirtualSources ? page.limit : page.limit;
    const initialOffset = hasVirtualSources ? 0 : page.offset;
    // A per-phase caller asked for per-phase numbers, so the ladder never
    // applies there — only the device-total branch below routes.
    const ladderTags = perPhase
        ? []
        : devicePowerTags({tags, bucket, commodity, electricalSource});
    const toRow = (r: {
        bucket: string | Date;
        device: number;
        tag: string;
        domain?: string;
        agg_value: number;
    }): EnergyQueryRow => ({
        bucket: toIso(r.bucket),
        device: r.device,
        shellyID: scope.idMap[r.device] ?? null,
        tag: r.tag as EnergyQueryTag,
        domain: r.domain ?? 'unspecified',
        value: scale(r.tag, r.agg_value)
    });
    /**
     * Replace the per-phase mean on the page's AC-mains power rows with the
     * device total. A value swap, not a second row source: the page keeps the
     * rows, the count and the order the DB paged, so limit/offset/has_more
     * still mean exactly what they meant before.
     */
    const swapDeviceTotals = async (
        rows: EnergyQueryRow[]
    ): Promise<EnergyQueryRow[]> => {
        const isLadderRow = (row: EnergyQueryRow): boolean =>
            row.domain === DEVICE_POWER_DOMAIN && ladderTags.includes(row.tag);
        const targets = rows.filter(isLadderRow);
        if (targets.length === 0) return rows;
        // Start at the page's first bucket to keep the read small, but never
        // before `from` — a bucket the request already clipped on the left
        // must stay clipped. The right edge keeps `to`, because trimming it
        // would average only the first slice of the page's last bucket.
        const firstBucketMs = Math.min(
            ...targets.map((row) => Date.parse(row.bucket))
        );
        const ladderFrom = new Date(Math.max(from.getTime(), firstBucketMs));
        // Without per-device rows the page carries device 0, so every device
        // in scope contributes to one summed fleet value per bucket.
        // The custom devices ride along so a source's total leaves out the
        // channels they represent.
        const ladderIds = baseOpts.perDevice
            ? [
                  ...new Set([
                      ...targets.map((row) => row.device),
                      ...aliasOwners
                  ])
              ]
            : baseOpts.internalIds;
        const totals = new Map<string, number>();
        await Promise.all(
            ladderTags.map(async (tag) => {
                const ladderRows = await repo.queryDevicePowerAvg({
                    internalIds: ladderIds,
                    from: ladderFrom,
                    to,
                    bucket,
                    phaseTag: tag,
                    totalTag: DEVICE_POWER_TAG_PAIRS[tag]
                });
                for (const row of ladderRows) {
                    const watts = Number(row.avg_w);
                    if (!Number.isFinite(watts)) continue;
                    const device = baseOpts.perDevice ? row.device : 0;
                    const key = `${toIso(row.bucket)}|${device}|${tag}`;
                    totals.set(key, (totals.get(key) ?? 0) + watts);
                }
            })
        );
        return rows.map((row) => {
            if (!isLadderRow(row)) return row;
            const total = totals.get(`${row.bucket}|${row.device}|${row.tag}`);
            // A missing ladder row means the rollup held nothing the ladder
            // could total; keep the generic value rather than blank the row.
            if (total === undefined) return row;
            return {...row, value: scale(row.tag, total)};
        });
    };
    const loadBasePage = async (
        limit: number,
        offset: number
    ): Promise<EnergyQueryRow[]> => {
        const opts = {...baseOpts, limit, offset};
        if (perPhase) {
            const rows = await repo.queryEnergyStatsByPhase(opts);
            return rows.map((r) => ({
                ...toRow(r),
                phase: r.phase
            }));
        }
        const rows = (await repo.queryEnergyStats(opts)).map(toRow);
        return ladderTags.length > 0 ? swapDeviceTotals(rows) : rows;
    };
    const firstBasePage = await loadBasePage(initialLimit, initialOffset);
    let base = firstBasePage;
    if (virtualIds.length === 0) return base;
    const sourceIdByExternalId = new Map(
        Object.entries(scope.idMap).map(([id, externalId]) => [
            externalId,
            Number(id)
        ])
    );
    const virtualTasks: Array<
        () => Promise<
            {
                row: EnergyQueryRow;
                lineage: string;
            }[]
        >
    > = [];
    for (const virtualId of virtualIds) {
        const externalId = scope.idMap[virtualId];
        for (const source of sources.get(virtualId) ?? []) {
            if (!tags.includes(source.tag)) continue;
            if (
                commodity &&
                source.commodity &&
                commodity !== source.commodity
            ) {
                continue;
            }
            if (
                electricalSource &&
                source.electricalSource &&
                electricalSource !== source.electricalSource
            ) {
                continue;
            }
            virtualTasks.push(async () => {
                const roleOrganizationId =
                    source.organizationId ?? organizationId;
                if (!roleOrganizationId) return [];
                const result = await virtualDeps.readRoleHistory(
                    roleOrganizationId,
                    {
                        externalId,
                        roleKey: source.roleKey,
                        from: from.toISOString(),
                        to: to.toISOString(),
                        bucket: bucket as EnergyBucket,
                        ...(commodity ? {commodity} : {}),
                        ...(electricalSource ? {electricalSource} : {}),
                        limit: Math.min(
                            ENERGY_QUERY_ROW_LIMIT + 1,
                            page.offset + page.limit
                        )
                    }
                );
                return result.items.map((point) => {
                    const pointSourceId = sourceIdByExternalId.get(
                        point.source.deviceExternalId
                    );
                    const pointChannel = componentChannel(
                        point.source.componentKey
                    );
                    const pointDomain = point.domain ?? 'unspecified';
                    const pointPhase = point.phase ?? 'z';
                    return {
                        row: {
                            bucket: point.ts,
                            device: virtualId,
                            shellyID: externalId,
                            tag: source.tag as EnergyQueryTag,
                            domain: pointDomain,
                            value:
                                virtualEnergyCounterValueKWh(
                                    source,
                                    point.value
                                ) ?? Number(point.value ?? 0),
                            ...(perPhase && isEnergyPhase(point.phase)
                                ? {phase: point.phase}
                                : {})
                        },
                        lineage: `${perDevice ? `${virtualId}|` : ''}${point.bindingId}|${pointSourceId ?? point.source.deviceExternalId}|${pointChannel}|${source.tag}|${point.ts}|${pointDomain}|${pointPhase}`
                    };
                });
            });
        }
    }
    if (virtualTasks.length === 0) return base;
    const virtual = (
        await Promise.all(virtualTasks.map((task) => task()))
    ).flat();
    let physical = base;
    const uniqueVirtual = new Map<string, EnergyQueryRow>();
    for (const item of virtual) {
        if (!uniqueVirtual.has(item.lineage)) {
            uniqueVirtual.set(item.lineage, item.row);
        }
    }
    const shapeRows = (): EnergyQueryRow[] =>
        aggregateEnergyRows(
            [...physical, ...uniqueVirtual.values()],
            perDevice,
            perPhase
        );
    // Project first, then aggregate. Two roles of the same custom device may
    // intentionally collapse into one public row. Continue the physical DB
    // cursor until the logical page is full, otherwise an alias-heavy first
    // batch can hide valid later rows.
    let shaped = shapeRows();
    let rawOffset = initialOffset + firstBasePage.length;
    let previousPageLength = firstBasePage.length;
    let previousPageLimit = initialLimit;
    while (
        shaped.length < page.limit &&
        previousPageLength === previousPageLimit
    ) {
        const nextLimit = Math.max(1, page.limit - shaped.length);
        const nextPage = await loadBasePage(nextLimit, rawOffset);
        rawOffset += nextPage.length;
        previousPageLength = nextPage.length;
        previousPageLimit = nextLimit;
        base = nextPage;
        physical = physical.concat(base);
        shaped = shapeRows();
    }
    shaped.sort(compareEnergyRows);
    return shaped;
}

function componentChannel(componentKey: string): number {
    const raw = componentKey.slice(componentKey.lastIndexOf(':') + 1);
    const channel = Number.parseInt(raw, 10);
    return Number.isInteger(channel) && channel >= 0 ? channel : 0;
}

function isEnergyPhase(value: unknown): value is 'a' | 'b' | 'c' {
    return value === 'a' || value === 'b' || value === 'c';
}

function aggregateEnergyRows(
    rows: readonly EnergyQueryRow[],
    perDevice: boolean,
    perPhase: boolean
): EnergyQueryRow[] {
    const grouped = new Map<string, EnergyQueryRow>();
    for (const row of rows) {
        const key = `${row.bucket}|${perDevice ? row.device : 0}|${row.tag}|${row.domain}|${perPhase ? (row.phase ?? 'z') : 'z'}`;
        const current = grouped.get(key);
        if (current) {
            current.value += row.value;
            continue;
        }
        grouped.set(key, {
            ...row,
            device: perDevice ? row.device : 0,
            shellyID: perDevice ? row.shellyID : null,
            ...(perPhase && row.phase ? {phase: row.phase} : {})
        });
    }
    return [...grouped.values()];
}

function compareEnergyRows(a: EnergyQueryRow, b: EnergyQueryRow): number {
    return (
        a.bucket.localeCompare(b.bucket) ||
        a.device - b.device ||
        a.tag.localeCompare(b.tag) ||
        a.domain.localeCompare(b.domain) ||
        (a.phase ?? '').localeCompare(b.phase ?? '')
    );
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
    dbLimit: number,
    sourceAccessSender: SenderCapabilities,
    virtualDeps: EnergyVirtualHistoryDeps
): Promise<EnergyQueryRow[]> {
    const field = ENV_ROLLUP_FIELD[envTag];
    if (!field) {
        // Defensive — classifyTags already vetted this. Surface the
        // tag loudly if it ever leaks past.
        throw RpcError.InvalidParams(`no env rollup field for tag ${envTag}`);
    }
    const virtualIds = scope.internalIds.filter((id) =>
        scope.idMap[id]?.startsWith('vdev_')
    );
    const loadedVirtualRoles =
        virtualIds.length > 0
            ? await (
                  virtualDeps.loadRoleSources ?? loadVirtualRoleHistorySources
              )(
                  virtualSourceOrganization(organizationId, sourceAccessSender),
                  virtualIds
              )
            : new Map();
    const virtualRoles =
        await filterReadableVirtualSourceMap<VirtualRoleSource>(
            sourceAccessSender,
            loadedVirtualRoles,
            {from, to}
        );
    const physicalIds = scope.internalIds.filter((id) => !virtualRoles.has(id));
    let rawOffset = 0;
    let previousLimit = dbLimit;
    let rows = await repo.queryEnvironmental({
        organizationId,
        internalIds: physicalIds,
        field,
        from,
        to,
        bucket,
        limit: previousLimit,
        ...(virtualRoles.size > 0 ? {offset: rawOffset} : {})
    });
    rawOffset += rows.length;
    const selectedIds = new Set(scope.internalIds);
    const aliasedPhysical = new Set<number>();
    const virtualRows: EnergyQueryRow[] = [];
    const seen = new Set<string>();
    for (const [virtualId, roles] of virtualRoles) {
        const externalId = scope.idMap[virtualId];
        for (const role of roles) {
            if (role.series !== 'sensor_numeric' || role.field !== field) {
                continue;
            }
            if (selectedIds.has(role.sourceDeviceListId)) {
                aliasedPhysical.add(role.sourceDeviceListId);
            }
            const roleOrganizationId = role.organizationId ?? organizationId;
            if (!roleOrganizationId) continue;
            const history = await virtualDeps.readRoleHistory(
                roleOrganizationId,
                {
                    externalId,
                    roleKey: role.roleKey,
                    from: from.toISOString(),
                    to: to.toISOString(),
                    bucket: bucket as EnergyBucket,
                    limit: dbLimit
                }
            );
            for (const point of history.items) {
                const pointSource =
                    point.readingSource ??
                    role.sensorSource ??
                    UNDECLARED_ROLE_SENSOR_SOURCE;
                if (!sensorSourceAccepted(pointSource, null)) continue;
                const lineage = `${virtualId}|${role.sourceDeviceListId}|${role.channel}|${field}|${point.ts}`;
                if (seen.has(lineage)) continue;
                seen.add(lineage);
                virtualRows.push({
                    bucket: point.ts,
                    device: virtualId,
                    shellyID: externalId,
                    tag: envTag as EnergyQueryTag,
                    domain: 'unspecified',
                    value: Number(point.value ?? 0),
                    min: point.min ?? null,
                    max: point.max ?? null,
                    source: pointSource
                });
            }
        }
    }
    const mapPhysical = (physicalRows: typeof rows) =>
        physicalRows
            .map((r) => ({
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
            }))
            // Env tags are read as the environment, and Energy.Query has no
            // source filter to opt back in with, so a device's own chip
            // temperature never belongs in these rows. Same rule as
            // Sensor.Query, which is where device health is readable.
            .filter(
                (row) =>
                    sensorSourceAccepted(row.source, null) &&
                    !aliasedPhysical.has(row.device)
            );
    const physical = mapPhysical(rows);
    while (
        physical.length + virtualRows.length < dbLimit &&
        rows.length === previousLimit
    ) {
        previousLimit = Math.max(
            1,
            dbLimit - physical.length - virtualRows.length
        );
        rows = await repo.queryEnvironmental({
            organizationId,
            internalIds: physicalIds,
            field,
            from,
            to,
            bucket,
            limit: previousLimit,
            offset: rawOffset
        });
        rawOffset += rows.length;
        physical.push(...mapPhysical(rows));
    }
    return [...physical, ...virtualRows].sort(compareEnergyRows);
}
