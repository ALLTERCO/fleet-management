// Energy.Query with a `meterIds` selector. Resolves each logical meter to
// its channel points, access-filters the devices, reads channel-grain
// energy, and attributes it back to the meters (pure logic in meterQuery).
// Energy tags only — power/voltage at meter grain is rejected, never silently
// averaged. Virtual (formula) meters are evaluated by combining the attributed
// rows of the physical meters they reference (pure logic in formulaMeter).

import {requireScopeRead} from '../../modules/authz/evaluator/scopeRead';
import type {EnergyRepository} from '../../modules/repositories/EnergyRepository';
import RpcError from '../../rpc/RpcError';
import {MAX_RANGE, parseDateRange} from '../../rpc/validation';
import type {
    EnergyBucket,
    EnergyLogicalMeter,
    EnergyLogicalMeterPoint,
    EnergyQueryParams,
    EnergyQueryResponse,
    EnergyQueryRow,
    EnergyQueryTag
} from '../../types/api/energy';
import {filterRowsByDeviceAccess} from './deviceAccessFilter';
import {
    assertFormulaInputsAccessible,
    evaluateFormulaMeters,
    resolveFormulaReferences
} from './formulaMeter';
import {groupMeterRows} from './meterGrouping';
import {
    attributeMeterEnergy,
    bucketSupportsMeterQuery,
    type ChannelEnergyRow,
    METER_ENERGY_TAGS,
    type MeterPointSet
} from './meterQuery';
import {
    assertQueryModifiers,
    pagedResponse,
    type SenderCapabilities
} from './queryHandler';

export interface MeterQueryDeps {
    repo: Pick<
        EnergyRepository,
        'queryEnergy15minByChannel' | 'resolveDevices' | 'resolveScopeShellyIDs'
    >;
    listMeters: (org: string) => Promise<EnergyLogicalMeter[]>;
}

export async function handleEnergyMeterQuery(
    validated: EnergyQueryParams,
    sender: SenderCapabilities,
    deps: MeterQueryDeps
): Promise<EnergyQueryResponse> {
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();
    assertQueryModifiers(validated);
    const grouped = validated.groupBy !== undefined;
    if (grouped) assertGroupable(validated);

    const bucket = validated.bucket ?? '1 day';
    assertBucketSupported(bucket);
    assertEnergyTags(validated.tags);
    const {from, to} = parseDateRange(
        validated.from,
        validated.to,
        MAX_RANGE.YEAR
    );

    const all = await deps.listMeters(org);
    const meterIds = grouped
        ? await groupedMeterIds(validated, all, sender, deps)
        : requireMeterSelector(validated);
    const selected = selectMeters(all, meterIds);
    const formulaMeters = selected.filter(isFormula);
    const referenced = resolveFormulaReferences(formulaMeters, all);
    // Attribute the directly-selected physical meters plus every physical meter
    // a formula references, so the combination has real per-bucket inputs.
    const physicalMeters = dedupeById([
        ...selected.filter((m) => !isFormula(m)),
        ...referenced
    ]);

    const allowed = await accessibleDevices(physicalMeters, sender);
    // A formula must not silently undercount: if the caller cannot read a
    // referenced device, fail loud rather than combine a zero/partial term.
    assertFormulaInputsAccessible(referenced, allowed, validated.tags);
    const meterSets = toMeterPointSets(physicalMeters, validated.tags, allowed);
    const internalIds = [...allowed];

    const startMs = Date.now();
    const channelRows =
        internalIds.length > 0
            ? ((await deps.repo.queryEnergy15minByChannel({
                  internalIds,
                  from,
                  to,
                  tags: validated.tags
              })) as ChannelEnergyRow[])
            : [];
    const physicalRows = attributeMeterEnergy(
        meterSets,
        channelRows,
        bucket,
        validated.timezone ?? null
    );
    const formulaRows = evaluateFormulaMeters(formulaMeters, physicalRows);
    // Output only what the caller asked for — a formula's referenced-only
    // physical meters are inputs, not results.
    const requested = new Set(meterIds);
    const rows = [...physicalRows, ...formulaRows].filter(
        (r) => r.meterId !== undefined && requested.has(r.meterId)
    );
    const executionMs = Date.now() - startMs;

    if (grouped) {
        return groupedResponse(rows, all, validated, {
            from,
            to,
            bucket,
            executionMs
        });
    }
    return page(rows, validated, {from, to, bucket, executionMs});
}

function requireMeterSelector(params: EnergyQueryParams): number[] {
    const meterIds = params.meterIds;
    if (!meterIds || meterIds.length === 0) {
        throw RpcError.InvalidParams('meterIds is required');
    }
    if (params.scope !== undefined || params.devices !== undefined) {
        throw RpcError.InvalidParams(
            'meterIds is mutually exclusive with scope and devices'
        );
    }
    return meterIds;
}

// A grouped query has no device or phase grain — those selectors are folded
// away, so combining them is a caller mistake, not a silent no-op.
function assertGroupable(params: EnergyQueryParams): void {
    if (params.perDevice) {
        throw RpcError.InvalidParams('groupBy cannot combine with perDevice');
    }
    if (params.perPhase) {
        throw RpcError.InvalidParams('groupBy cannot combine with perPhase');
    }
}

// Grouped selection: explicit meterIds, or the meters in a group/location
// scope, or every org meter. Meters carry group/location, so scope narrowing
// is a pure filter — no extra device resolution.
async function groupedMeterIds(
    params: EnergyQueryParams,
    all: EnergyLogicalMeter[],
    sender: SenderCapabilities,
    deps: MeterQueryDeps
): Promise<number[]> {
    if (params.meterIds !== undefined) {
        if (params.scope !== undefined || params.devices !== undefined) {
            throw RpcError.InvalidParams(
                'groupBy: meterIds is mutually exclusive with scope and devices'
            );
        }
        return params.meterIds;
    }
    return (await scopedMeters(params, all, sender, deps)).map((m) => m.id);
}

// Meter selection for a grouped query: explicit devices or a tag scope resolve
// to device ids and keep meters that read them; group/location filter on the
// meter's own assignment; no selector means every org meter.
async function scopedMeters(
    params: EnergyQueryParams,
    all: EnergyLogicalMeter[],
    sender: SenderCapabilities,
    deps: MeterQueryDeps
): Promise<EnergyLogicalMeter[]> {
    if (params.devices !== undefined) {
        return metersOnDevices(all, await deviceIds(params.devices, deps));
    }
    const scope = params.scope;
    if (!scope) return all;
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();
    await requireScopeRead(sender, scope, org, {
        resolve: (orgId, kind, id) =>
            deps.repo.resolveScopeShellyIDs({
                orgId,
                scopeKind: kind,
                scopeId: id
            })
    });
    if (scope.groupId !== undefined) {
        return all.filter((m) => m.groupId === scope.groupId);
    }
    if (scope.locationId !== undefined) {
        return all.filter((m) => m.locationId === scope.locationId);
    }
    if (scope.tagId !== undefined) {
        const shellyIDs = await deps.repo.resolveScopeShellyIDs({
            orgId: org,
            scopeKind: 'tag',
            scopeId: scope.tagId
        });
        return metersOnDevices(all, await deviceIds(shellyIDs, deps));
    }
    return all;
}

async function deviceIds(
    shellyIDs: readonly string[],
    deps: MeterQueryDeps
): Promise<Set<number>> {
    if (shellyIDs.length === 0) return new Set();
    const {internalIds} = await deps.repo.resolveDevices(shellyIDs);
    return new Set(internalIds);
}

// A meter is in scope when one of its points reads an in-scope device.
function metersOnDevices(
    meters: EnergyLogicalMeter[],
    ids: ReadonlySet<number>
): EnergyLogicalMeter[] {
    return meters.filter((m) => m.points.some((p) => ids.has(p.deviceId)));
}

// Fold the attributed per-meter rows into one series per group. The grouper is
// the shared SSOT with the report breakdown, so the two never drift. Pagination
// applies to grouped rows; `items` stays empty.
function groupedResponse(
    rows: EnergyQueryRow[],
    meters: EnergyLogicalMeter[],
    params: EnergyQueryParams,
    meta: {from: Date; to: Date; bucket: EnergyBucket; executionMs: number}
): EnergyQueryResponse {
    const dimension = params.groupBy as NonNullable<
        EnergyQueryParams['groupBy']
    >;
    const groups = groupMeterRows(rows, meters, {
        dimension,
        totals: params.totals ?? false,
        // A formula meter is a real series under 'meter', but must not fold
        // into role/kind/utility totals where it would double-count its inputs.
        includeFormula: dimension === 'meter'
    });
    const paginated = params.limit !== undefined;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? groups.length;
    const total = groups.length;
    const end = paginated ? Math.min(total, offset + limit) : total;
    const pageRows = offset < total ? groups.slice(offset, end) : [];
    return {
        items: [],
        groups: pageRows,
        total,
        limit,
        offset,
        has_more: paginated && end < total,
        meta: {
            from: meta.from.toISOString(),
            to: meta.to.toISOString(),
            bucket: meta.bucket,
            executionMs: meta.executionMs
        }
    };
}

function assertBucketSupported(bucket: EnergyBucket): void {
    if (!bucketSupportsMeterQuery(bucket)) {
        throw RpcError.InvalidParams(
            `bucket '${bucket}' is not supported for meter queries — use 15 minutes through 1 day`
        );
    }
}

function assertEnergyTags(tags: readonly EnergyQueryTag[]): void {
    const allowed = new Set<string>(METER_ENERGY_TAGS);
    const bad = tags.filter((t) => !allowed.has(t));
    if (bad.length > 0) {
        throw RpcError.InvalidParams(
            `meter queries support energy tags only — remove: ${bad.join(', ')}`
        );
    }
}

function selectMeters(
    all: EnergyLogicalMeter[],
    ids: number[]
): EnergyLogicalMeter[] {
    const wanted = new Set(ids);
    return all.filter((m) => wanted.has(m.id));
}

function isFormula(m: EnergyLogicalMeter): boolean {
    return m.aggregationMode === 'formula';
}

function dedupeById(meters: EnergyLogicalMeter[]): EnergyLogicalMeter[] {
    const byId = new Map(meters.map((m) => [m.id, m]));
    return [...byId.values()];
}

// Map the meters' point devices through the per-device access filter and
// return the internal ids the caller may read.
async function accessibleDevices(
    meters: EnergyLogicalMeter[],
    sender: SenderCapabilities
): Promise<Set<number>> {
    const deviceIds = new Set<number>();
    for (const m of meters) for (const p of m.points) deviceIds.add(p.deviceId);
    const rows = [...deviceIds].map((deviceId) => ({deviceId}));
    const allowed = await filterRowsByDeviceAccess(rows, sender);
    return new Set(allowed.map((r) => r.deviceId));
}

function toMeterPointSets(
    meters: EnergyLogicalMeter[],
    tags: readonly EnergyQueryTag[],
    allowed: Set<number>
): MeterPointSet[] {
    const tagSet = new Set<string>(tags);
    return meters.map((m) => ({
        id: m.id,
        points: m.points
            .filter(
                (p: EnergyLogicalMeterPoint) =>
                    tagSet.has(p.tag) && allowed.has(p.deviceId)
            )
            .map((p) => ({
                deviceId: p.deviceId,
                channel: p.channel,
                tag: p.tag
            }))
    }));
}

function page(
    rows: EnergyQueryRow[],
    params: EnergyQueryParams,
    meta: {from: Date; to: Date; bucket: EnergyBucket; executionMs: number}
): EnergyQueryResponse {
    const paginated = params.limit !== undefined;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? rows.length;
    const total = rows.length;
    const end = paginated ? Math.min(total, offset + limit) : total;
    const items = offset < total ? rows.slice(offset, end) : [];
    const has_more = paginated && end < total;
    return pagedResponse(items, {
        limit,
        offset,
        has_more,
        from: meta.from,
        to: meta.to,
        bucket: meta.bucket,
        executionMs: meta.executionMs,
        // Exact — the full set is materialized in memory here.
        total
    });
}
