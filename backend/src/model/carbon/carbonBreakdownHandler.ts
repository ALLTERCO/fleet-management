import {tuning} from '../../config/index.js';
import {requireScopeRead} from '../../modules/authz/evaluator/scopeRead.js';
import * as PostgresProvider from '../../modules/PostgresProvider.js';
import type {EmissionFactorOverlapSelector} from '../../modules/repositories/CarbonRepository.js';
import {defaultEnergyRepository} from '../../modules/repositories/EnergyRepository.js';
import {
    resolveLocationShellyIDs,
    resolveScopeShellyIDs
} from '../../modules/scopeResolver.js';
import RpcError from '../../rpc/RpcError.js';
import {validateOrThrow} from '../../rpc/validateOrThrow.js';
import {MAX_RANGE, parseDateRange} from '../../rpc/validation.js';
import {
    CARBON_CALCULATE_BREAKDOWN_PARAMS_SCHEMA,
    type CarbonBreakdownFactorRef,
    type CarbonBreakdownPoint,
    type CarbonBreakdownStatus,
    type CarbonBreakdownValue,
    type CarbonCalculateBreakdownParams,
    type CarbonCalculateBreakdownResponse,
    type CarbonCalculateBreakdownWarning,
    type CarbonLocationBreakdown,
    type EmissionFactorSpec
} from '../../types/api/carbon.js';
import type {
    EnergyQueryParams,
    EnergyQueryRow
} from '../../types/api/energy.js';
import {type ScopeKind, scopeId, scopeKind} from '../../types/api/fleet.js';
import type CommandSender from '../CommandSender.js';
import {
    handleEnergyQuery,
    type SenderCapabilities
} from '../energy/queryHandler.js';
import {fetchDashboardCarbonOverrides} from '../report/dashboardCarbonContext.js';
import {resolveLocationIdsForEnergyReport} from '../report/energyEngineHelpers.js';
import {
    type FleetJoinScope,
    resolveQuantityCoverageInterval
} from '../report/energyReportCost.js';
import {
    buildDepthMap,
    pickDeepestNode,
    type ScopeNode
} from '../report/energyReportScopeBreakdown.js';
import {dateInZone} from '../report/localTimeInZone.js';
import {localMidnightToUtc, shiftMonth} from '../report/reportPeriod.js';
import {assertReportSafety} from '../report/reportSafety.js';
import {quantityMetric} from '../report/tariffQuantity.js';

interface CarbonLocationNode extends ScopeNode {
    countryCode: string | null;
}

export interface CarbonBreakdownDeps {
    queryEnergy(
        params: EnergyQueryParams,
        sender: SenderCapabilities
    ): Promise<{items: EnergyQueryRow[]}>;
    listLocations(orgId: string): Promise<CarbonLocationNode[]>;
    resolveLocations(
        orgId: string,
        locationIds: readonly number[]
    ): Promise<Map<number, string[]>>;
    resolveScope(
        orgId: string,
        kind: ScopeKind,
        id: number | null
    ): Promise<string[]>;
    resolveCoverageScope(shellyIDs: readonly string[]): Promise<FleetJoinScope>;
    loadDashboardOverrides(
        dashboardId: number | undefined,
        orgId: string
    ): Promise<{lbmGPerKWh: number | null}>;
    deploymentFactorKgPerKWh: number | null;
}

export interface CarbonBreakdownFactorRepository {
    listOverlappingFactors(
        org: string,
        selector: EmissionFactorOverlapSelector
    ): Promise<Required<EmissionFactorSpec>[]>;
}

const productionDeps: CarbonBreakdownDeps = {
    async queryEnergy(params, sender) {
        return handleEnergyQuery(
            params,
            sender,
            await defaultEnergyRepository()
        );
    },
    listLocations: listOrganizationLocations,
    resolveLocations: resolveLocationShellyIDs,
    resolveScope: resolveScopeShellyIDs,
    async resolveCoverageScope(shellyIDs) {
        const repo = await defaultEnergyRepository();
        const scope = await repo.resolveDevices(shellyIDs);
        return {
            internalIds: scope.internalIds,
            readJoinDates: (internalIds) =>
                repo.resolveDeviceJoinDates(internalIds)
        };
    },
    loadDashboardOverrides: fetchDashboardCarbonOverrides,
    deploymentFactorKgPerKWh: tuning.energy.emissionFactorLbmGPerKWh / 1000
};

interface LocationListRow {
    id: number;
    name: string;
    parent_location_id: number | null;
    total_count?: number | string | null;
}

function carbonQuantityMetric() {
    const metric = quantityMetric('electricity', 'kWh');
    if (metric === null) {
        throw new Error(
            'the electricity/kWh carbon quantity metric is missing'
        );
    }
    return metric;
}

const CARBON_QUANTITY_METRIC = carbonQuantityMetric();

async function listOrganizationLocations(
    orgId: string
): Promise<CarbonLocationNode[]> {
    const pageSize = 1000;
    const rows: LocationListRow[] = [];
    let offset = 0;
    let total = 0;
    do {
        const result = await PostgresProvider.callMethod(
            'organization.fn_location_list',
            {
                p_organization_id: orgId,
                p_parent_id: null,
                p_roots_only: false,
                p_limit: pageSize,
                p_offset: offset,
                p_allowed_ids: null,
                p_include_summary: false
            }
        );
        const page = (result?.rows ?? []) as LocationListRow[];
        rows.push(...page);
        total =
            page.length > 0
                ? Number(page[0]?.total_count ?? rows.length)
                : rows.length;
        offset += page.length;
    } while (offset < total);
    if (rows.length === 0) return [];
    const effective = await PostgresProvider.callMethod(
        'organization.fn_location_resolve_effective_many',
        {p_organization_id: orgId, p_ids: rows.map((row) => row.id)}
    );
    const countries = new Map(
        (
            (effective?.rows ?? []) as Array<{
                id: number;
                country_code: string | null;
            }>
        ).map((row) => [row.id, row.country_code ?? null])
    );
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_location_id,
        countryCode: countries.get(row.id) ?? null
    }));
}

interface BucketAccumulator {
    bucketStart: string;
    bucketEnd: string;
    quantityKWh: number;
    coveredQuantityKWh: number;
    uncoveredQuantityKWh: number;
    coveredImpactKgCO2e: number;
    factorKeys: Set<string>;
}

interface LocationAccumulator {
    locationId: number | null;
    locationName: string;
    region: string;
    buckets: Map<string, BucketAccumulator>;
}

function roundSix(value: number): number {
    return +value.toFixed(6);
}

function valueFrom(input: {
    quantityKWh: number;
    coveredQuantityKWh: number;
    uncoveredQuantityKWh: number;
    coveredImpactKgCO2e: number;
    factorKeys: Iterable<string>;
}): CarbonBreakdownValue {
    const quantityKWh = roundSix(input.quantityKWh);
    const coveredQuantityKWh = roundSix(input.coveredQuantityKWh);
    const uncoveredQuantityKWh = roundSix(input.uncoveredQuantityKWh);
    const coveredImpactKgCO2e = roundSix(input.coveredImpactKgCO2e);
    const status: CarbonBreakdownStatus =
        uncoveredQuantityKWh <= 1e-9
            ? 'complete'
            : coveredQuantityKWh > 1e-9
              ? 'partial'
              : 'unconfigured';
    const projectImpactKgCO2e =
        status === 'complete' ? coveredImpactKgCO2e : null;
    return {
        status,
        quantityKWh,
        coveredQuantityKWh,
        uncoveredQuantityKWh,
        projectImpactKgCO2e,
        coveredImpactKgCO2e,
        scope2KgCO2e: projectImpactKgCO2e,
        factorKeys: [...new Set(input.factorKeys)].sort()
    };
}

function factorKey(input: {
    source: CarbonBreakdownFactorRef['source'];
    id: number | null;
    revision: number | null;
    region: string;
    sourceReference: string;
}): string {
    return [
        input.source,
        input.region,
        input.id ?? 'none',
        input.revision ?? 'none',
        input.sourceReference
    ].join(':');
}

function storedFactorRef(
    factor: Required<EmissionFactorSpec>
): CarbonBreakdownFactorRef {
    const key = factorKey({
        source: 'factor_store',
        id: factor.id,
        revision: factor.revision,
        region: factor.region,
        sourceReference: factor.sourceReference
    });
    return {
        key,
        id: factor.id,
        region: factor.region,
        factorKgPerUnit: factor.factorKgPerUnit,
        source: 'factor_store',
        sourceReference: factor.sourceReference,
        revision: factor.revision,
        effectiveFrom: factor.effectiveFrom,
        effectiveTo: factor.effectiveTo,
        accountingBasis: 'location_based',
        emissionsScope: 'scope2'
    };
}

function constantFactorRef(input: {
    source: 'dashboard_override' | 'deployment_default';
    region: string;
    factorKgPerUnit: number;
    sourceReference: string;
}): CarbonBreakdownFactorRef {
    const key = factorKey({...input, id: null, revision: null});
    return {
        key,
        id: null,
        region: input.region,
        factorKgPerUnit: input.factorKgPerUnit,
        source: input.source,
        sourceReference: input.sourceReference,
        revision: null,
        effectiveFrom: null,
        effectiveTo: null,
        accountingBasis: 'location_based',
        emissionsScope: 'scope2'
    };
}

function selectStoredFactor(
    factors: readonly Required<EmissionFactorSpec>[],
    region: string,
    at: number
): Required<EmissionFactorSpec> | null {
    return (
        factors
            .filter((factor) => {
                const start = new Date(factor.effectiveFrom).getTime();
                const end =
                    factor.effectiveTo === null
                        ? Number.POSITIVE_INFINITY
                        : new Date(factor.effectiveTo).getTime();
                return (
                    (factor.region === region || factor.region === 'global') &&
                    start <= at &&
                    at < end
                );
            })
            .sort((a, b) => {
                const exact =
                    Number(b.region === region) - Number(a.region === region);
                if (exact !== 0) return exact;
                const effective =
                    new Date(b.effectiveFrom).getTime() -
                    new Date(a.effectiveFrom).getTime();
                if (effective !== 0) return effective;
                if (b.revision !== a.revision) return b.revision - a.revision;
                return b.id - a.id;
            })[0] ?? null
    );
}

function bucketForTimestamp(
    timestamp: string,
    starts: readonly string[]
): string | null {
    const target = new Date(timestamp).getTime();
    let match: string | null = null;
    for (const start of starts) {
        if (new Date(start).getTime() > target) break;
        match = start;
    }
    return match;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        out.push(items.slice(index, index + size));
    }
    return out;
}

function carbonBucketEnd(
    start: Date,
    granularity: CarbonCalculateBreakdownParams['granularity'],
    timezone: string | undefined
): Date {
    if (granularity === '15 minutes') {
        return new Date(start.getTime() + 15 * 60_000);
    }
    if (granularity === '1 hour') {
        return new Date(start.getTime() + 60 * 60_000);
    }
    const local = dateInZone(start, timezone ?? null);
    if (granularity === '1 month') {
        const next = shiftMonth(local.year, local.month, 1);
        return localMidnightToUtc(
            {year: next.year, month: next.month, day: 1},
            timezone ?? null
        );
    }
    const nextDay = new Date(
        Date.UTC(local.year, local.month - 1, local.day + 1)
    );
    return localMidnightToUtc(
        {
            year: nextDay.getUTCFullYear(),
            month: nextDay.getUTCMonth() + 1,
            day: nextDay.getUTCDate()
        },
        timezone ?? null
    );
}

async function queryRows(
    params: CarbonCalculateBreakdownParams,
    devices: readonly string[],
    bucket: EnergyQueryParams['bucket'],
    sender: SenderCapabilities,
    deps: CarbonBreakdownDeps
): Promise<EnergyQueryRow[]> {
    const pages = await Promise.all(
        chunks(devices, 500).map((deviceBatch) =>
            deps.queryEnergy(
                {
                    from: params.from,
                    to: params.to,
                    tags: ['total_act_energy'],
                    commodity: 'electricity',
                    bucket,
                    perDevice: true,
                    devices: deviceBatch,
                    ...(params.timezone === undefined
                        ? {}
                        : {timezone: params.timezone})
                },
                sender
            )
        )
    );
    return pages.flatMap((page) => page.items);
}

async function resolveDevices(input: {
    params: CarbonCalculateBreakdownParams;
    sender: CommandSender;
    orgId: string;
    locations: readonly CarbonLocationNode[];
    deps: CarbonBreakdownDeps;
}): Promise<{
    devices: string[];
    candidateLocationIds: number[];
    selectedLocations?: Map<number, string[]>;
}> {
    const {params, sender, orgId, locations, deps} = input;
    const nodesById = new Map(
        locations.map((location) => [location.id, location])
    );
    if (params.locationIds !== undefined) {
        const missing = params.locationIds.filter((id) => !nodesById.has(id));
        if (missing.length > 0) {
            throw RpcError.NotFound('location', String(missing[0]));
        }
        const selected = await resolveLocationIdsForEnergyReport(
            params.locationIds,
            sender,
            orgId,
            {resolveLocations: deps.resolveLocations}
        );
        return {
            devices: selected.shellyIDs,
            candidateLocationIds: params.locationIds,
            selectedLocations: selected.byLocation
        };
    }
    await requireScopeRead(sender, params.scope, orgId, {
        resolve: deps.resolveScope,
        requireFullAccess: true
    });
    const devices = [
        ...new Set(
            await deps.resolveScope(
                orgId,
                scopeKind(params.scope),
                scopeId(params.scope)
            )
        )
    ];
    if (devices.length === 0) {
        throw RpcError.Domain('ValidationFailed', {
            field: 'scope',
            message: 'The selected scope must contain at least one device.'
        });
    }
    return {
        devices,
        candidateLocationIds: locations.map((location) => location.id)
    };
}

export async function handleCarbonCalculateBreakdown(
    rawParams: unknown,
    sender: CommandSender,
    carbonRepo: CarbonBreakdownFactorRepository,
    deps: CarbonBreakdownDeps = productionDeps
): Promise<CarbonCalculateBreakdownResponse> {
    const params = validateOrThrow<CarbonCalculateBreakdownParams>(
        rawParams,
        CARBON_CALCULATE_BREAKDOWN_PARAMS_SCHEMA
    );
    if (params.scope !== undefined && params.locationIds !== undefined) {
        throw RpcError.InvalidParams(
            'scope and locationIds are mutually exclusive'
        );
    }
    const {from, to} = parseDateRange(params.from, params.to, MAX_RANGE.YEAR);
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    const locations = await deps.listLocations(orgId);
    const {devices, candidateLocationIds, selectedLocations} =
        await resolveDevices({
            params,
            sender,
            orgId,
            locations,
            deps
        });
    const reportGranularity = {
        '15 minutes': 'fifteen_minutes',
        '1 hour': 'hour',
        '1 day': 'day',
        '1 month': 'month'
    }[params.granularity];
    assertReportSafety({
        deviceCount: devices.length,
        from,
        to,
        granularity: reportGranularity,
        seriesCount: 1
    });

    const devicesByLocation =
        selectedLocations ??
        (await deps.resolveLocations(orgId, candidateLocationIds));
    const locationsByDevice = new Map<string, number[]>();
    const selectedDevices = new Set(devices);
    for (const [locationId, shellyIDs] of devicesByLocation) {
        for (const shellyID of shellyIDs) {
            if (!selectedDevices.has(shellyID)) continue;
            const ids = locationsByDevice.get(shellyID) ?? [];
            ids.push(locationId);
            locationsByDevice.set(shellyID, ids);
        }
    }
    const depth = buildDepthMap(locations);
    const locationByDevice = new Map(
        devices.map((shellyID) => [
            shellyID,
            pickDeepestNode(locationsByDevice.get(shellyID) ?? [], depth)
        ])
    );

    const displayRows = await queryRows(
        params,
        devices,
        params.granularity,
        sender,
        deps
    );
    const canonicalRows =
        params.granularity === '15 minutes'
            ? displayRows
            : await queryRows(params, devices, '15 minutes', sender, deps);
    const coverageScope = await deps.resolveCoverageScope(devices);
    const dataCoverage = await resolveQuantityCoverageInterval(
        canonicalRows,
        from,
        to,
        CARBON_QUANTITY_METRIC,
        coverageScope
    );
    const warnings: CarbonCalculateBreakdownWarning[] =
        dataCoverage.status === 'partial'
            ? [
                  {
                      code: 'partial_data_coverage',
                      message:
                          `Recorded electricity coverage begins at ${dataCoverage.coveredFrom.toISOString()} ` +
                          `within the requested ${dataCoverage.requestedFrom.toISOString()} through ` +
                          `${dataCoverage.requestedTo.toISOString()} period. The missing pre-enrollment ` +
                          'interval is excluded, not treated as zero.'
                  }
              ]
            : [];
    const bucketStarts = [
        ...new Set(displayRows.map((row) => row.bucket))
    ].sort((a, b) => a.localeCompare(b));
    const rangeEndMs = new Date(params.to).getTime();
    const bucketEnds = new Map(
        bucketStarts.map((start) => [
            start,
            new Date(
                Math.min(
                    carbonBucketEnd(
                        new Date(start),
                        params.granularity,
                        params.timezone
                    ).getTime(),
                    rangeEndMs
                )
            ).toISOString()
        ])
    );

    const nodesById = new Map(
        locations.map((location) => [location.id, location])
    );
    const usedLocationIds = new Set<number | null>();
    for (const row of canonicalRows) {
        if (row.shellyID !== null) {
            usedLocationIds.add(locationByDevice.get(row.shellyID) ?? null);
        }
    }
    const accumulators = new Map<number | null, LocationAccumulator>();
    for (const locationId of usedLocationIds) {
        const location =
            locationId === null ? undefined : nodesById.get(locationId);
        accumulators.set(locationId, {
            locationId,
            locationName: location?.name ?? 'Unassigned',
            region: location?.countryCode?.trim() || 'global',
            buckets: new Map()
        });
    }
    const regions = [
        ...new Set([...accumulators.values()].map((item) => item.region))
    ];
    const [storedFactors, dashboardOverrides] = await Promise.all([
        carbonRepo.listOverlappingFactors(orgId, {
            commodity: 'electricity',
            billedUnit: 'kWh',
            regions,
            accountingBasis: 'location_based',
            emissionsScope: 'scope2',
            from: params.from,
            to: params.to
        }),
        deps.loadDashboardOverrides(params.dashboardId, orgId)
    ]);
    const factorRefs = new Map<string, CarbonBreakdownFactorRef>();
    const dashboardFactor =
        dashboardOverrides.lbmGPerKWh === null
            ? null
            : constantFactorRef({
                  source: 'dashboard_override',
                  region: 'dashboard',
                  factorKgPerUnit: dashboardOverrides.lbmGPerKWh / 1000,
                  sourceReference: `dashboard:${params.dashboardId}`
              });
    const deploymentFactor =
        deps.deploymentFactorKgPerKWh === null
            ? null
            : constantFactorRef({
                  source: 'deployment_default',
                  region: 'global',
                  factorKgPerUnit: deps.deploymentFactorKgPerKWh,
                  sourceReference: 'deployment:energy.emissionFactorLbmGPerKWh'
              });

    for (const row of canonicalRows) {
        if (row.shellyID === null) continue;
        const locationId = locationByDevice.get(row.shellyID) ?? null;
        const location = accumulators.get(locationId);
        const displayBucket = bucketForTimestamp(row.bucket, bucketStarts);
        const bucketEnd =
            displayBucket === null ? undefined : bucketEnds.get(displayBucket);
        if (!location || displayBucket === null || bucketEnd === undefined)
            continue;
        let bucket = location.buckets.get(displayBucket);
        if (!bucket) {
            bucket = {
                bucketStart: displayBucket,
                bucketEnd,
                quantityKWh: 0,
                coveredQuantityKWh: 0,
                uncoveredQuantityKWh: 0,
                coveredImpactKgCO2e: 0,
                factorKeys: new Set()
            };
            location.buckets.set(displayBucket, bucket);
        }
        const quantity = Math.max(0, row.value);
        bucket.quantityKWh += quantity;
        const stored = selectStoredFactor(
            storedFactors,
            location.region,
            new Date(row.bucket).getTime()
        );
        const factor =
            dashboardFactor ??
            (stored === null ? null : storedFactorRef(stored)) ??
            deploymentFactor;
        if (factor === null) {
            bucket.uncoveredQuantityKWh += quantity;
            continue;
        }
        factorRefs.set(factor.key, factor);
        bucket.coveredQuantityKWh += quantity;
        bucket.coveredImpactKgCO2e += quantity * factor.factorKgPerUnit;
        bucket.factorKeys.add(factor.key);
    }

    const locationResults = [...accumulators.values()]
        .map<CarbonLocationBreakdown>((location) => {
            const series = [...location.buckets.values()]
                .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
                .map<CarbonBreakdownPoint>((bucket) => ({
                    bucketStart: bucket.bucketStart,
                    bucketEnd: bucket.bucketEnd,
                    ...valueFrom(bucket)
                }));
            return {
                locationId: location.locationId,
                locationName: location.locationName,
                region: location.region,
                ...valueFrom({
                    quantityKWh: series.reduce(
                        (sum, item) => sum + item.quantityKWh,
                        0
                    ),
                    coveredQuantityKWh: series.reduce(
                        (sum, item) => sum + item.coveredQuantityKWh,
                        0
                    ),
                    uncoveredQuantityKWh: series.reduce(
                        (sum, item) => sum + item.uncoveredQuantityKWh,
                        0
                    ),
                    coveredImpactKgCO2e: series.reduce(
                        (sum, item) => sum + item.coveredImpactKgCO2e,
                        0
                    ),
                    factorKeys: series.flatMap((item) => item.factorKeys)
                }),
                series
            };
        })
        .sort((a, b) => {
            if (a.locationId === null) return 1;
            if (b.locationId === null) return -1;
            return (
                a.locationName.localeCompare(b.locationName) ||
                a.locationId - b.locationId
            );
        });

    const series = bucketStarts
        .map<CarbonBreakdownPoint>((bucketStart) => {
            const points = locationResults.flatMap((location) =>
                location.series.filter(
                    (point) => point.bucketStart === bucketStart
                )
            );
            return {
                bucketStart,
                bucketEnd: bucketEnds.get(bucketStart) ?? params.to,
                ...valueFrom({
                    quantityKWh: points.reduce(
                        (sum, item) => sum + item.quantityKWh,
                        0
                    ),
                    coveredQuantityKWh: points.reduce(
                        (sum, item) => sum + item.coveredQuantityKWh,
                        0
                    ),
                    uncoveredQuantityKWh: points.reduce(
                        (sum, item) => sum + item.uncoveredQuantityKWh,
                        0
                    ),
                    coveredImpactKgCO2e: points.reduce(
                        (sum, item) => sum + item.coveredImpactKgCO2e,
                        0
                    ),
                    factorKeys: points.flatMap((item) => item.factorKeys)
                })
            };
        })
        .filter((point) => point.quantityKWh > 0);
    const factorAggregate = valueFrom({
        quantityKWh: series.reduce((sum, item) => sum + item.quantityKWh, 0),
        coveredQuantityKWh: series.reduce(
            (sum, item) => sum + item.coveredQuantityKWh,
            0
        ),
        uncoveredQuantityKWh: series.reduce(
            (sum, item) => sum + item.uncoveredQuantityKWh,
            0
        ),
        coveredImpactKgCO2e: series.reduce(
            (sum, item) => sum + item.coveredImpactKgCO2e,
            0
        ),
        factorKeys: series.flatMap((item) => item.factorKeys)
    });
    const aggregate: CarbonBreakdownValue =
        dataCoverage.status === 'partial'
            ? {
                  ...factorAggregate,
                  status:
                      factorAggregate.status === 'unconfigured'
                          ? 'unconfigured'
                          : 'partial',
                  projectImpactKgCO2e: null,
                  scope2KgCO2e: null
              }
            : factorAggregate;
    return {
        from: params.from,
        to: params.to,
        granularity: params.granularity,
        locationsAdditive: true,
        factorCoverageStatus: factorAggregate.status,
        dataCoverage: {
            basis: 'recorded_quantity_interval',
            status: dataCoverage.status,
            requestedFrom: dataCoverage.requestedFrom.toISOString(),
            requestedTo: dataCoverage.requestedTo.toISOString(),
            coveredFrom: dataCoverage.coveredFrom.toISOString(),
            coveredTo: dataCoverage.coveredTo.toISOString(),
            fraction: dataCoverage.fraction
        },
        warnings,
        factors: [...factorRefs.values()].sort((a, b) =>
            a.key.localeCompare(b.key)
        ),
        series,
        locations: locationResults,
        ...aggregate
    };
}
