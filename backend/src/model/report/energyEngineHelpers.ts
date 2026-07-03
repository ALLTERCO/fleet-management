// Helpers consumed only by energyEngine.ts (and energy-adjacent renderers/tests).

import {getLogger} from 'log4js';
import {tuning} from '../../config';
// Leaf import (not the barrel) — matches EnergyRepository's rollup routing.
import {bucketUsesRollup} from '../../config/energy';
import type {GroupKindCategory} from '../../config/groupKindCatalog';
import {requireScopeRead} from '../../modules/authz/evaluator/scopeRead';
import * as DashboardRegistry from '../../modules/DashboardRegistry';
import {isValidTimezone} from '../../modules/location/isoData';
import {incrementLabeledCounter} from '../../modules/Observability';
import {readOrganizationProfile} from '../../modules/organizationModel';
import * as PostgresProvider from '../../modules/PostgresProvider';
import type {EnergyStatsRow} from '../../modules/repositories/EnergyRepository';
import {listLogicalMeters} from '../../modules/repositories/LogicalMeterRepository';
import {resolveScopeShellyIDs} from '../../modules/scopeResolver';
import RpcError from '../../rpc/RpcError';
import type {EnergyLogicalMeter, EnergyMeterRole} from '../../types/api/energy';
import {type DashboardScope, scopeId, scopeKind} from '../../types/api/fleet';
import type CommandSender from '../CommandSender';
import type {PhaseGroup} from './anomalies';
import {computeBatteryEfficiency} from './batteryEfficiency';
import {reconcileBill} from './billReconciliation';
import {allocateCost, type ServesLink} from './costAllocation';
import {computeDemandCharges} from './demandCharges';
import {
    deviceDisplayName,
    deviceHardwareType,
    type ScopeResult,
    scopeShellyIDs
} from './engineHelpers';
import {
    applySectionAllowlist,
    type ReportSectionId,
    selectSections
} from './sectionDispatch';
import {computeSolarSelfConsumption} from './solarSelfConsumption';
import {computeTenantBilling} from './tenantBilling';

// Shared with the frontend so report symbols stay consistent.
export {currencySymbol} from '../../types/api/_currency';

const logger = getLogger('energyReport');
const RECONCILIATION_EPSILON = 0.01;

type ReportRoleBucket =
    | 'service_entrance'
    | 'submeter'
    | 'solar_pv'
    | 'battery_bess'
    | 'ev_charger'
    | 'hvac'
    | 'lighting'
    | 'tenant'
    | 'transformer'
    | 'general';

// Effective report currency: caller's choice wins, else the org default, else
// EUR. Uses || so an empty-string currency counts as "not set" (a blank code
// must not blank out every money symbol).
export function resolveReportCurrency(
    paramCurrency: string | undefined,
    orgCurrency: string | null | undefined
): string {
    return paramCurrency || orgCurrency || 'EUR';
}

// Report currency for an org, honoring a caller override. Reads the org's
// configured default only when the caller did not pin one.
export async function reportCurrencyFor(
    orgId: string,
    paramCurrency: string | undefined
): Promise<string> {
    if (paramCurrency) return paramCurrency;
    const profile = await readOrganizationProfile(orgId);
    return resolveReportCurrency(paramCurrency, profile?.currencyDefault);
}

// The IANA zone that anchors a report's bill-period matching: caller override
// wins, else the org default, else null (UTC). A caller zone must be real, so a
// typo fails loudly instead of silently shifting which bill is matched.
export async function reportTimezoneFor(
    orgId: string,
    paramTimezone: string | undefined,
    readProfile = readOrganizationProfile
): Promise<string | null> {
    if (paramTimezone) {
        if (!isValidTimezone(paramTimezone))
            throw RpcError.InvalidParams(`Unknown timezone '${paramTimezone}'`);
        return paramTimezone;
    }
    const profile = await readProfile(orgId);
    return profile?.timezoneDefault ?? null;
}

// SUMMARY total must equal sum of per-device costs within float epsilon —
// divergence means rounding crept in upstream and per-device rows lie.
export function checkReportReconciles(
    summaryTotalCost: number,
    devices: readonly {cost: number}[],
    logger: {
        warn: (msg: string, ...rest: unknown[]) => void;
    }
): void {
    const summed = devices.reduce((sum, d) => sum + d.cost, 0);
    if (Math.abs(summed - summaryTotalCost) <= RECONCILIATION_EPSILON) return;
    logger.warn(
        'Report reconciliation drift: summed per-device cost %s ≠ SUMMARY %s (Δ %s)',
        summed.toFixed(4),
        summaryTotalCost.toFixed(4),
        (summed - summaryTotalCost).toFixed(4)
    );
}

interface RoleGatedContext {
    readonly roles: Awaited<ReturnType<typeof shellyIDsByRole>>;
    readonly tsRows: ReadonlyArray<{
        date?: unknown;
        device?: unknown;
        consumption_kwh?: unknown;
        returned_kwh?: unknown;
        power_avg_w?: unknown;
    }>;
    readonly deviceAgg: Map<number, {cons: number; ret: number; cost: number}>;
    readonly deviceMap: Map<number, string>;
    readonly tariff: number;
    readonly currencySymbol: string;
    // Template allowlist; null/undefined renders every triggered section.
    readonly allowedSections?: readonly string[] | null;
}

type RowConstructor = (...cells: any[]) => Record<string, any>;

type SectionRenderer = (
    rows: Record<string, any>[],
    R: RowConstructor,
    ctx: RoleGatedContext
) => void;

// Renderer per section. null = the section routes but has no content yet.
const SECTION_RENDERERS: Record<ReportSectionId, SectionRenderer | null> = {
    demand: appendDemandChargesRows,
    solar: appendSolarSelfConsumptionRows,
    battery: appendBatteryEfficiencyRows,
    ev: appendEVChargingRows,
    tenant: appendTenantBillingRows
};

// The kind categories a scope holds, derived from the roles present. Bridges
// device roles to the catalog categories that drive section dispatch.
function categoriesFromRoles(
    roles: RoleGatedContext['roles']
): Set<GroupKindCategory> {
    const categories = new Set<GroupKindCategory>();
    if (roles.service_entrance.length) categories.add('electrical');
    if (roles.solar_pv.length) categories.add('solar');
    if (roles.battery_bess.length) categories.add('energy_storage');
    if (roles.ev_charger.length) categories.add('ev');
    if (roles.tenant.length) categories.add('property');
    return categories;
}

// Sections to render for the roles in scope, in catalog order.
export function sectionsForRoles(
    roles: RoleGatedContext['roles']
): ReportSectionId[] {
    return selectSections(categoriesFromRoles(roles));
}

// Catalog-driven dispatch: a section renders when its kind category is in
// scope. The category table (sectionDispatch) is the one decision source.
export function appendRoleGatedRows(
    rows: Record<string, any>[],
    R: RowConstructor,
    ctx: RoleGatedContext
): void {
    const selected = applySectionAllowlist(
        sectionsForRoles(ctx.roles),
        ctx.allowedSections
    );
    for (const id of selected) {
        const render = SECTION_RENDERERS[id];
        if (!render) continue;
        incrementLabeledCounter('fm_report_section_rendered', {section: id});
        render(rows, R, ctx);
    }
}

// Sum consumed + returned energy across the in-scope devices for a role.
function sumAggForRole(
    ctx: RoleGatedContext,
    shellyIds: readonly string[]
): {cons: number; ret: number} {
    const wanted = new Set(shellyIds);
    let cons = 0;
    let ret = 0;
    for (const [id, agg] of ctx.deviceAgg) {
        const shellyId = ctx.deviceMap.get(id);
        if (shellyId !== undefined && wanted.has(shellyId)) {
            cons += agg.cons;
            ret += agg.ret;
        }
    }
    return {cons, ret};
}

// Serves links per in-scope device, for cost allocation. Empty when none.
export async function servesByDevice(
    organizationId: string,
    shellyIDs: readonly string[],
    deps: RoleSourceDeps = defaultRoleSourceDeps
): Promise<Map<string, ServesLink[]>> {
    if (shellyIDs.length === 0) return new Map();
    const rows = await deps.queryRows<{
        source_device_id: string;
        target_kind: string;
        target_id: string;
        weight: number | string | null;
    }>(
        `SELECT source_device_id, target_kind, target_id, weight
           FROM device.device_serves
          WHERE organization_id = $1 AND source_device_id = ANY($2::text[])`,
        [organizationId, [...shellyIDs]]
    );
    const map = new Map<string, ServesLink[]>();
    for (const r of rows) {
        const list = map.get(r.source_device_id) ?? [];
        list.push({
            targetType: r.target_kind,
            targetId: r.target_id,
            weight: r.weight == null ? null : Number(r.weight)
        });
        map.set(r.source_device_id, list);
    }
    return map;
}

export interface AllocationTarget {
    targetType: string;
    targetId: string;
    cost: number;
}

export interface FleetAllocation {
    // Keyed by (targetType, targetId) — a target is a polymorphic (type, id)
    // pair, so a group and a location that share a numeric id never collide.
    perTarget: Map<string, AllocationTarget>;
    unallocated: number;
}

function targetKey(targetType: string, targetId: string): string {
    return `${targetType}\u0000${targetId}`;
}

function addTarget(
    map: Map<string, AllocationTarget>,
    targetType: string,
    targetId: string,
    cost: number
): void {
    const key = targetKey(targetType, targetId);
    const prev = map.get(key);
    map.set(key, {targetType, targetId, cost: (prev?.cost ?? 0) + cost});
}

// Total cost per served target across the fleet, plus the unallocated remainder.
export function allocateFleetCost(input: {
    deviceAgg: ReadonlyMap<number, {cost: number}>;
    deviceMap: ReadonlyMap<number, string>;
    serves: ReadonlyMap<string, ServesLink[]>;
}): FleetAllocation {
    const perTarget = new Map<string, AllocationTarget>();
    let unallocated = 0;
    for (const [id, agg] of input.deviceAgg) {
        const shellyId = input.deviceMap.get(id);
        const links = (shellyId && input.serves.get(shellyId)) || [];
        const result = allocateCost({
            deviceCost: agg.cost,
            serves: links,
            fallback: 'unallocated'
        });
        unallocated += result.unallocated;
        for (const [targetId, cost] of result.perTarget) {
            const targetType =
                links.find((l) => l.targetId === targetId)?.targetType ??
                'unknown';
            addTarget(perTarget, targetType, targetId, cost);
        }
    }
    return {perTarget, unallocated};
}

// One-level recursion: a group target's cost flows to its member devices,
// split equally. Members are devices, so it never recurses further. A group
// with no known members is left as-is.
export function expandGroupTargets(
    perTarget: ReadonlyMap<string, AllocationTarget>,
    groupMembers: ReadonlyMap<string, readonly string[]>
): Map<string, AllocationTarget> {
    const out = new Map<string, AllocationTarget>();
    for (const {targetType, targetId, cost} of perTarget.values()) {
        const members =
            targetType === 'group' ? groupMembers.get(targetId) : null;
        if (!members || members.length === 0) {
            addTarget(out, targetType, targetId, cost);
            continue;
        }
        const share = cost / members.length;
        for (const deviceId of members)
            addTarget(out, 'device', deviceId, share);
    }
    return out;
}

// Section: fleet cost split across served targets. Skipped when nothing served.
export function appendCostAllocationRows(
    rows: Record<string, any>[],
    R: RowConstructor,
    allocation: FleetAllocation,
    currency: string
): void {
    if (allocation.perTarget.size === 0) return;
    incrementLabeledCounter('fm_report_section_rendered', {
        section: 'cost_alloc'
    });
    const allocated = [...allocation.perTarget.values()].reduce(
        (sum, t) => sum + t.cost,
        0
    );
    const denom = allocated + allocation.unallocated || 1;
    const share = (cost: number) => `${((cost / denom) * 100).toFixed(1)}%`;
    for (const {targetType, targetId, cost} of allocation.perTarget.values()) {
        rows.push(
            allocationRow(R, currency, {
                label: `${targetType}:${targetId}`,
                cost,
                sharePct: share(cost),
                note: 'Shared-cost allocation by served target'
            })
        );
    }
    if (allocation.unallocated > 0) {
        rows.push(
            allocationRow(R, currency, {
                label: 'unallocated',
                cost: allocation.unallocated,
                sharePct: share(allocation.unallocated),
                note: 'No serves link'
            })
        );
    }
}

// Section: report cost vs the actual utility bill. Skipped when no bill is
// recorded for the report period.
export function appendBillReconciliationRows(
    rows: Record<string, any>[],
    R: RowConstructor,
    input: {
        reportCost: number;
        actual: {actualCost: number; currency: string} | null;
        currency: string;
    }
): void {
    if (!input.actual) return;
    incrementLabeledCounter('fm_report_section_rendered', {
        section: 'bill_recon'
    });
    const v = reconcileBill(input.reportCost, input.actual.actualCost);
    const sign = v.variancePct >= 0 ? '+' : '';
    const sym = input.currency;
    rows.push(
        R(
            'BILL_RECON',
            '',
            'Bill reconciliation',
            '',
            '',
            '',
            '',
            `${sym}${input.actual.actualCost.toFixed(2)}`,
            '',
            '',
            '',
            '',
            '',
            '',
            `${sign}${v.variancePct.toFixed(1)}%`,
            '',
            '',
            `Report ${sym}${input.reportCost.toFixed(2)} vs bill ${sym}${input.actual.actualCost.toFixed(2)} — ${v.status}`
        )
    );
}

function allocationRow(
    R: RowConstructor,
    currency: string,
    cell: {label: string; cost: number; sharePct: string; note: string}
): Record<string, any> {
    return R(
        'COST_ALLOC',
        '',
        cell.label,
        '',
        '',
        '',
        '',
        `${currency}${cell.cost.toFixed(2)}`,
        '',
        '',
        '',
        '',
        '',
        '',
        cell.sharePct,
        '',
        '',
        cell.note
    );
}

function appendDemandChargesRows(
    rows: Record<string, any>[],
    R: RowConstructor,
    ctx: RoleGatedContext
): void {
    const mainSet = new Set(ctx.roles.service_entrance);
    const samples = ctx.tsRows
        .map((r) => toDemandSample(r, mainSet, ctx.deviceMap))
        .filter((s): s is {powerKW: number; ts: Date} => s !== null);
    if (samples.length === 0) return;
    const result = computeDemandCharges({
        samples,
        windowMinutes: 60, // tsRows are hourly; widen window to match.
        demandRate: 0 // no rate metadata yet — report kW only, cost omitted
    });
    if (result.peakKW <= 0) return;
    rows.push(
        R(
            'DEMAND',
            '',
            'Peak hourly demand',
            '',
            '',
            '',
            '',
            '',
            +(result.peakKW * 1000).toFixed(0),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            `${result.peakKW} kW peak${result.peakStart ? ` at ${result.peakStart.toISOString()}` : ''} — service entrance metering`
        )
    );
}

function appendSolarSelfConsumptionRows(
    rows: Record<string, any>[],
    R: RowConstructor,
    ctx: RoleGatedContext
): void {
    // PV-role meter: cons = energy out of inverter, ret = energy exported.
    const {cons: produced, ret: exported} = sumAggForRole(
        ctx,
        ctx.roles.solar_pv
    );
    if (produced <= 0) return;
    const result = computeSolarSelfConsumption({
        producedKWh: produced,
        exportedKWh: exported
    });
    rows.push(
        R(
            'SOLAR',
            '',
            'Solar self-consumption',
            '',
            +produced.toFixed(3),
            +exported.toFixed(3),
            +(produced - exported).toFixed(3),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            `${result.selfConsumptionRatePct}%`,
            '',
            '',
            `${result.selfConsumedKWh} kWh self-used (measured at PV inverter, not heuristic)`
        )
    );
}

function appendBatteryEfficiencyRows(
    rows: Record<string, any>[],
    R: RowConstructor,
    ctx: RoleGatedContext
): void {
    // BESS meter: cons = energy into battery (charge), ret = out (discharge).
    const {cons: charged, ret: discharged} = sumAggForRole(
        ctx,
        ctx.roles.battery_bess
    );
    if (charged <= 0 && discharged <= 0) return;
    const result = computeBatteryEfficiency({
        chargedKWh: charged,
        dischargedKWh: discharged
    });
    rows.push(
        R(
            'BATTERY',
            '',
            'Round-trip efficiency',
            '',
            +result.chargedKWh.toFixed(3),
            +result.dischargedKWh.toFixed(3),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            result.roundTripPct !== null ? `${result.roundTripPct}%` : '—',
            '',
            '',
            `${result.losses} kWh lost in conversion`
        )
    );
}

// EV charging energy delivered across the org's charge points. Phase-agnostic:
// it sums energy (kWh), which already includes every phase of a 3-phase
// charger, so single- and 3-phase chargers report the same way.
function appendEVChargingRows(
    rows: Record<string, any>[],
    R: RowConstructor,
    ctx: RoleGatedContext
): void {
    const {cons: delivered} = sumAggForRole(ctx, ctx.roles.ev_charger);
    if (delivered <= 0) return;
    const points = ctx.roles.ev_charger.length;
    rows.push(
        R(
            'EV',
            '',
            'EV charging delivered',
            '',
            +delivered.toFixed(3),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            `${delivered.toFixed(1)} kWh delivered across ${points} charge point(s)`
        )
    );
}

function appendTenantBillingRows(
    rows: Record<string, any>[],
    R: RowConstructor,
    ctx: RoleGatedContext
): void {
    const tenantSet = new Set(ctx.roles.tenant);
    const usages = [...ctx.deviceAgg.entries()]
        .map(([id, agg]) => ({
            shellyId: ctx.deviceMap.get(id),
            agg
        }))
        .filter((row) => row.shellyId && tenantSet.has(row.shellyId))
        .map((row) => ({
            costCenter: costCenterFor(row.shellyId!, ctx.roles.costCenters),
            kWh: row.agg.cons,
            cost: row.agg.cost
        }));
    if (usages.length === 0) return;
    const result = computeTenantBilling(usages);
    for (const billingRow of result.rows) {
        rows.push(
            R(
                'TENANT',
                '',
                billingRow.costCenter,
                '',
                billingRow.kWh,
                '',
                '',
                `${ctx.currencySymbol}${billingRow.cost.toFixed(2)}`,
                '',
                '',
                '',
                '',
                '',
                '',
                `${billingRow.sharePct}%`,
                '',
                '',
                'Tenant-meter allocation by cost center'
            )
        );
    }
}

function costCenterFor(
    shellyId: string,
    costCenters: ReadonlyMap<string, string[]>
): string | null {
    for (const [center, ids] of costCenters) {
        if (ids.includes(shellyId)) return center;
    }
    return null;
}

function toDemandSample(
    row: {date?: unknown; device?: unknown; power_avg_w?: unknown},
    mainShellyIds: ReadonlySet<string>,
    deviceMap: ReadonlyMap<number, string>
): {powerKW: number; ts: Date} | null {
    const deviceId = typeof row.device === 'number' ? row.device : null;
    if (deviceId === null) return null;
    const shellyId = deviceMap.get(deviceId);
    if (!shellyId || !mainShellyIds.has(shellyId)) return null;
    const power = row.power_avg_w;
    if (typeof power !== 'number' || !Number.isFinite(power)) return null;
    const ts =
        row.date instanceof Date
            ? row.date
            : typeof row.date === 'string'
              ? new Date(row.date)
              : null;
    if (!ts || Number.isNaN(ts.getTime())) return null;
    return {powerKW: power / 1000, ts};
}

// Injectable seam for the logical-meter role reads (and device_serves links).
export interface RoleSourceDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<T[]>;
    listLogicalMeters(orgId: string): Promise<EnergyLogicalMeter[]>;
}

const defaultRoleSourceDeps: RoleSourceDeps = {
    queryRows: PostgresProvider.queryRows,
    listLogicalMeters
};

// Logical-meter role → the report's role bucket. The bucket vocabulary feeds the
// solar/battery/ev/tenant sections; tenant is keyed off a meter's cost center,
// not a role.
const ROLE_TO_BUCKET: Partial<Record<EnergyMeterRole, ReportRoleBucket>> = {
    grid: 'service_entrance',
    pv: 'solar_pv',
    battery: 'battery_bess',
    ev_charge: 'ev_charger',
    load: 'general'
};

// Per-role shellyID index; a device reached from both sources lands once.
function roleIndex(): {
    buckets: Record<ReportRoleBucket, string[]>;
    add: (role: ReportRoleBucket, shellyId: string) => void;
} {
    const empty = (): string[] => [];
    const buckets: Record<ReportRoleBucket, string[]> = {
        service_entrance: empty(),
        submeter: empty(),
        solar_pv: empty(),
        battery_bess: empty(),
        ev_charger: empty(),
        hvac: empty(),
        lighting: empty(),
        tenant: empty(),
        transformer: empty(),
        general: empty()
    };
    const seen: Partial<Record<ReportRoleBucket, Set<string>>> = {};
    const add = (role: ReportRoleBucket, shellyId: string): void => {
        const set = (seen[role] ??= new Set());
        if (set.has(shellyId)) return;
        set.add(shellyId);
        buckets[role].push(shellyId);
    };
    return {buckets, add};
}

// Record a device under its cost center; no center means no allocation. Idempotent
// so a device carrying the same center in both sources is listed once.
function indexCostCenter(
    costCenters: Map<string, string[]>,
    costCenter: string | null | undefined,
    shellyId: string
): void {
    if (costCenter == null) return;
    const list = costCenters.get(costCenter) ?? [];
    if (list.includes(shellyId)) return;
    list.push(shellyId);
    costCenters.set(costCenter, list);
}

// shellyIDs per role, from logical-meter roles (not catalog_kind). A device is
// in a bucket when one of its channels belongs to a meter of that role; cost
// centers come from the meter's cost_center. Empty buckets = section N/A.
export async function shellyIDsByRole(
    organizationId: string,
    shellyIDs: readonly string[],
    deviceMap: ReadonlyMap<number, string>,
    deps: RoleSourceDeps = defaultRoleSourceDeps
): Promise<
    Record<ReportRoleBucket, string[]> & {costCenters: Map<string, string[]>}
> {
    const {buckets, add} = roleIndex();
    const costCenters = new Map<string, string[]>();
    const scope = new Set(shellyIDs);

    for (const meter of await deps.listLogicalMeters(organizationId)) {
        const bucket = ROLE_TO_BUCKET[meter.role];
        for (const point of meter.points) {
            const shellyId = deviceMap.get(point.deviceId);
            if (!shellyId || !scope.has(shellyId)) continue;
            if (bucket) add(bucket, shellyId);
            if (meter.costCenter) {
                add('tenant', shellyId);
                indexCostCenter(costCenters, meter.costCenter, shellyId);
            }
        }
    }
    return Object.assign(buckets, {costCenters});
}

// Hourly TS row → splitByDayOfWeek input. Skips rows with malformed dates.
export function parseHourlySample(row: {
    date?: unknown;
    consumption_kwh?: unknown;
}): {hour: Date; kWh: number} | null {
    const dateValue = row.date;
    const kWhValue = row.consumption_kwh;
    if (typeof kWhValue !== 'number' || !Number.isFinite(kWhValue)) return null;
    const date =
        dateValue instanceof Date
            ? dateValue
            : typeof dateValue === 'string'
              ? new Date(dateValue)
              : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    return {hour: date, kWh: kWhValue};
}

// 5 even bands spanning 0..peak — keeps the duration curve readable.
export function chooseLoadDurationBands(peakKW: number): number[] {
    if (!Number.isFinite(peakKW) || peakKW <= 0) return [0];
    const step = peakKW / 5;
    return [0, step, step * 2, step * 3, step * 4];
}

// Mean power factor across time-series rows that reported one.
export function averagePowerFactor(
    rows: ReadonlyArray<{power_factor_avg?: number | null}>
): number | null {
    const samples: number[] = [];
    for (const row of rows) {
        const value = row.power_factor_avg;
        if (typeof value === 'number' && Number.isFinite(value)) {
            samples.push(value);
        }
    }
    if (samples.length === 0) return null;
    const sum = samples.reduce((a, b) => a + b, 0);
    return sum / samples.length;
}

// Worst per-row imbalance % across phase rows, null when none.
export function maxPhaseImbalancePct(
    phaseRows: ReadonlyArray<{imbalance_pct?: number | null}>
): number | null {
    let worst: number | null = null;
    for (const row of phaseRows) {
        const value = row.imbalance_pct;
        if (typeof value === 'number' && Number.isFinite(value)) {
            worst = worst === null ? value : Math.max(worst, value);
        }
    }
    return worst;
}

// Adds the in-scope devices of every role=grid logical meter to the set —
// the main/service-entrance meters. Replaces the old catalog_kind='main_meter'
// device flag; the logical meter's role is now the single source.
export async function unionGridMeterDevices(
    orgId: string,
    target: Set<string>,
    deviceMap: ReadonlyMap<number, string>,
    deps: RoleSourceDeps = defaultRoleSourceDeps
): Promise<void> {
    for (const meter of await deps.listLogicalMeters(orgId)) {
        if (meter.role !== 'grid') continue;
        for (const point of meter.points) {
            const shellyId = deviceMap.get(point.deviceId);
            if (shellyId) target.add(shellyId);
        }
    }
}

// Fraction of priorTotalCons the top-of-current device drew last period.
// Returns null when no comparison is possible — caller treats null as cold-start.
export function priorTopShare(
    topDeviceId: number | undefined,
    priorConsByDevice: Map<number, number>,
    priorTotalCons: number
): number | null {
    if (topDeviceId === undefined || priorTotalCons <= 0) return null;
    const priorCons = priorConsByDevice.get(topDeviceId) ?? 0;
    if (priorCons <= 0) return null;
    return priorCons / priorTotalCons;
}
export interface EnergyReportRow {
    section: string;
    date: any;
    device: any;
    phase: any;
    consumption_kwh: any;
    returned_kwh: any;
    net_kwh: any;
    cost: any;
    power_w: any;
    voltage_v: any;
    voltage_min_v: any;
    voltage_max_v: any;
    current_a: any;
    current_max_a: any;
    share_pct: any;
    imbalance_pct: any;
    delta_pct: any;
    notes: any;
}

/** Named-column row builder; unset columns render as empty cells. Named (not
 *  positional) so a caller cannot silently swap two columns. */
export function energyRow(cells: Partial<EnergyReportRow>): EnergyReportRow {
    return {
        section: '',
        date: '',
        device: '',
        phase: '',
        consumption_kwh: '',
        returned_kwh: '',
        net_kwh: '',
        cost: '',
        power_w: '',
        voltage_v: '',
        voltage_min_v: '',
        voltage_max_v: '',
        current_a: '',
        current_max_a: '',
        share_pct: '',
        imbalance_pct: '',
        delta_pct: '',
        notes: '',
        ...cells
    };
}

/** Blank row — visible separator between CSV sections. */
export function energyRowBlank(): EnergyReportRow {
    return energyRow({});
}

/** % deviation of worst leg from 3-phase avg; blank if <2 legs or avg=0. */
export function phaseImbalancePct(group: PhaseGroup | undefined): string {
    if (!group) return '';
    const powers = [group.l1, group.l2, group.l3].filter((p) => p > 0);
    if (powers.length < 2) return '';
    const avg = powers.reduce((a, b) => a + b, 0) / powers.length;
    if (avg <= 0) return '';
    const maxDev = Math.max(...powers.map((p) => Math.abs(p - avg)));
    return `${Math.round((maxDev / avg) * 100)}%`;
}

export interface DeviceAggregate {
    cons: number;
    ret: number;
    cost: number;
    powerSum: number;
    powerCount: number;
    voltSum: number;
    voltCount: number;
    currSum: number;
    currCount: number;
}

interface TopConsumer {
    deviceId: number;
    device: string;
    shellyId: string;
    type: string;
    cons: number;
    ret: number;
    cost: number;
    avgPower: number;
    avgVolt: number;
    avgCurr: number;
}

/** Devices ranked by consumption + averages + hw type. */
export function buildTopConsumers(
    deviceAgg: Map<number, DeviceAggregate>,
    deviceMap: Map<number, string>
): TopConsumer[] {
    return [...deviceAgg.entries()]
        .map(([did, da]) => ({
            deviceId: did,
            device: deviceDisplayName(did, deviceMap),
            shellyId: deviceMap.get(did) ?? '',
            type: deviceHardwareType(did, deviceMap),
            cons: da.cons,
            ret: da.ret,
            cost: da.cost,
            avgPower: da.powerCount > 0 ? da.powerSum / da.powerCount : 0,
            avgVolt: da.voltCount > 0 ? da.voltSum / da.voltCount : 0,
            avgCurr: da.currCount > 0 ? da.currSum / da.currCount : 0
        }))
        .sort((a, b) => b.cons - a.cons);
}
export async function resolveScopeOnlyForEnergyReport(
    scopeParam: DashboardScope | null | undefined,
    sender: CommandSender,
    orgId: string
): Promise<{shellyIDs: string[]; scope: ScopeResult}> {
    await requireScopeRead(sender, scopeParam, orgId, {
        resolve: resolveScopeShellyIDs
    });
    const rawShellyIDs = await resolveScopeShellyIDs(
        orgId,
        scopeKind(scopeParam),
        scopeId(scopeParam)
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

// Cross-org guard for the dashboardId param; uses single SoT registry check.
export async function assertDashboardOwnedBySender(
    dashboardId: number | undefined,
    _sender: CommandSender,
    orgId: string
): Promise<void> {
    if (dashboardId === undefined) return;
    const owns = await DashboardRegistry.dashboardBelongsToOrg(
        dashboardId,
        orgId
    );
    if (!owns) throw RpcError.NotFound('dashboard', String(dashboardId));
}

// Best-effort: empty map on PG failure so deltas degrade to "no prior".
export async function fetchPriorConsumptionByDevice(
    internalIds: number[],
    priorFrom: Date,
    priorTo: Date,
    bucket: string
): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (priorTo.getTime() <= priorFrom.getTime()) return out;
    try {
        // Same rollup routing as the current-period read — a prior window
        // older than the 31-day raw retention must not read empty.
        const res = await PostgresProvider.callMethod(
            reportStatsFunctions(bucket).combinedFn,
            {
                p_devices: internalIds,
                p_from: priorFrom,
                p_to: priorTo,
                p_tags: ['total_act_energy'],
                p_bucket: bucket,
                p_per_device: true,
                p_limit: tuning.report.maxRows + 1,
                p_offset: 0
            }
        );
        for (const r of (res?.rows ?? []) as EnergyStatsRow[]) {
            if (r.tag !== 'total_act_energy') continue;
            const kwh = (r.agg_value ?? 0) / 1000;
            out.set(r.device, (out.get(r.device) ?? 0) + kwh);
        }
    } catch (err) {
        // Degrade to "no prior" so current-period reporting survives, but
        // surface it — a silent empty delta otherwise looks like real zero.
        logger.warn('prior-period consumption read failed; delta = none', err);
    }
    return out;
}

// Raw device_em.stats is dropped after 31 days, so report windows that reach
// past it must read the long-term rollup. ≥15-min buckets (every report) take
// the rollup path, mirroring EnergyRepository.queryEnergyStats.
export function reportStatsFunctions(bucket: string): {
    combinedFn: string;
    phaseFn: string;
} {
    return bucketUsesRollup(bucket)
        ? {
              combinedFn: 'device_em.fn_report_stats_rollup_paged',
              phaseFn: 'device_em.fn_report_stats_rollup_by_phase_paged'
          }
        : {
              combinedFn: 'device_em.fn_report_stats_paged',
              phaseFn: 'device_em.fn_report_stats_by_phase_paged'
          };
}

export async function fetchEnergyStatsParallel(
    internalIds: number[],
    fromDate: Date,
    toDate: Date,
    bucket: string
): Promise<{
    combinedRep: {rows: EnergyStatsRow[]};
    phaseRep: {rows: EnergyStatsRow[]};
}> {
    const allTags = [
        'total_act_energy',
        'total_act_ret_energy',
        'power',
        'voltage',
        'min_voltage',
        'max_voltage',
        'current',
        'min_current',
        'max_current',
        // power_factor enables PF penalty + recommendation rows; ignored
        // when devices don't emit it (averagePowerFactor returns null).
        'power_factor'
    ];
    const rowCap = tuning.report.maxRows + 1;
    const baseParams = {
        p_devices: internalIds,
        p_from: fromDate,
        p_to: toDate,
        p_tags: allTags,
        p_bucket: bucket,
        p_per_device: true,
        p_limit: rowCap,
        p_offset: 0
    };
    const {combinedFn, phaseFn} = reportStatsFunctions(bucket);
    const [combinedRep, phaseRep] = await Promise.all([
        PostgresProvider.callMethod(combinedFn, {...baseParams}),
        PostgresProvider.callMethod(phaseFn, {...baseParams})
    ]);
    if (
        combinedRep.rows.length > tuning.report.maxRows ||
        phaseRep.rows.length > tuning.report.maxRows
    ) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Energy report result too large (combined=${combinedRep.rows.length}, phase=${phaseRep.rows.length}). Use a coarser granularity or shorter date range.`,
            field: 'range',
            details: {
                combinedRowCount: combinedRep.rows.length,
                phaseRowCount: phaseRep.rows.length,
                limit: tuning.report.maxRows
            }
        });
    }
    return {combinedRep, phaseRep};
}
