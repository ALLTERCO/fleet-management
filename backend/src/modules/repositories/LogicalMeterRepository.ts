// Persistence seam for fm.logical_meter + fm.logical_meter_point. Pure
// SQL wrapper over the fm.fn_*_logical_meter(s) stored functions — no
// caching, no in-memory state. Every call is org-scoped: the stored
// functions refuse cross-org reads/writes, so one organization can never
// see or edit another's meters. DB CHECK constraints guarantee the
// returned vocabulary values match the API union types, so rows map to
// the API shape with no boundary cast.

import type {
    EnergyLogicalMeter,
    EnergyLogicalMeterPoint,
    EnergyVirtualFormula
} from '../../types/api/energy';
import {
    callMethod,
    type DbResult,
    extractScalarBoolean,
    extractScalarNumber,
    queryRows,
    rawCall
} from '../PostgresProvider';

export interface SaveLogicalMeterDbParams {
    /** null = create, else update that meter within the org. */
    id: number | null;
    org: string;
    name: string;
    utilityType: string;
    role: string;
    kindId: string | null;
    phaseMode: string;
    aggregationMode: string;
    parentMeterId: number | null;
    groupId: number | null;
    locationId: number | null;
    costCenter: string | null;
    virtualFormula: EnergyVirtualFormula | null;
    points: EnergyLogicalMeterPoint[];
}

export async function saveLogicalMeter(
    params: SaveLogicalMeterDbParams
): Promise<number> {
    const result = await callMethod('fm.fn_save_logical_meter', {
        p_id: params.id,
        p_org: params.org,
        p_name: params.name,
        p_utility_type: params.utilityType,
        p_role: params.role,
        p_kind_id: params.kindId,
        p_phase_mode: params.phaseMode,
        p_aggregation_mode: params.aggregationMode,
        p_parent_meter_id: params.parentMeterId,
        p_group_id: params.groupId,
        p_location_id: params.locationId,
        p_cost_center: params.costCenter,
        p_virtual_formula: params.virtualFormula
            ? JSON.stringify(params.virtualFormula)
            : null,
        p_points: JSON.stringify(params.points)
    });
    return extractScalarNumber(result);
}

export async function deleteLogicalMeter(
    id: number,
    org: string
): Promise<boolean> {
    const result = await callMethod('fm.fn_delete_logical_meter', {
        p_id: id,
        p_org: org
    });
    return extractScalarBoolean(result);
}

export async function listLogicalMeters(
    org: string,
    groupId?: number,
    locationId?: number
): Promise<EnergyLogicalMeter[]> {
    const result = await rawCall('fm.fn_list_logical_meters', {
        p_org: org,
        p_group_id: groupId ?? null,
        p_location_id: locationId ?? null
    });
    return mapMeterRows(result);
}

// A meter may tag itself with a group/location; both must belong to the
// caller's org or the save references another tenant's scope tree.
export function groupBelongsToOrg(
    org: string,
    groupId: number
): Promise<boolean> {
    return existsInOrgScopedTable('organization.groups', groupId, org);
}

export function locationBelongsToOrg(
    org: string,
    locationId: number
): Promise<boolean> {
    return existsInOrgScopedTable('organization.locations', locationId, org);
}

// `table` is always a fixed literal from the two callers above — never input.
async function existsInOrgScopedTable(
    table: string,
    id: number,
    org: string
): Promise<boolean> {
    const rows = await queryRows<{exists: boolean}>(
        `SELECT EXISTS(
            SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2
        ) AS exists`,
        [id, org]
    );
    return rows[0]?.exists === true;
}

function mapMeterRows(result: unknown): EnergyLogicalMeter[] {
    const rows = (result as DbResult)?.rows ?? [];
    return rows.map((r) => ({
        id: Number(r.id),
        name: r.name as string,
        utilityType: r.utility_type as EnergyLogicalMeter['utilityType'],
        role: r.role as EnergyLogicalMeter['role'],
        kindId: (r.kind_id as string | null) ?? null,
        phaseMode: r.phase_mode as EnergyLogicalMeter['phaseMode'],
        aggregationMode:
            r.aggregation_mode as EnergyLogicalMeter['aggregationMode'],
        parentMeterId: numberOrNull(r.parent_meter_id),
        groupId: numberOrNull(r.group_id),
        locationId: numberOrNull(r.location_id),
        costCenter: (r.cost_center as string | null) ?? null,
        virtualFormula:
            (r.virtual_formula as EnergyVirtualFormula | null) ?? null,
        points: mapPoints(r.points)
    }));
}

function mapPoints(value: unknown): EnergyLogicalMeterPoint[] {
    const raw = (value as Record<string, unknown>[] | null) ?? [];
    return raw.map((p) => ({
        deviceId: Number(p.deviceId),
        componentKey: p.componentKey as string,
        channel: Number(p.channel ?? 0),
        phase: (p.phase as EnergyLogicalMeterPoint['phase']) ?? 'z',
        tag: p.tag as EnergyLogicalMeterPoint['tag'],
        electricalDomain:
            (p.electricalDomain as EnergyLogicalMeterPoint['electricalDomain']) ??
            null,
        directionHint:
            (p.directionHint as EnergyLogicalMeterPoint['directionHint']) ??
            null
    }));
}

function numberOrNull(value: unknown): number | null {
    return value === null || value === undefined ? null : Number(value);
}
