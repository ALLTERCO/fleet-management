// Persistence seam for fm.logical_meter + fm.logical_meter_point. Pure
// SQL wrapper over the fm.fn_*_logical_meter(s) stored functions — no
// caching, no in-memory state. Every call is org-scoped: the stored
// functions refuse cross-org reads/writes, so one organization can never
// see or edit another's meters. DB CHECK constraints guarantee the
// returned vocabulary values match the API union types, so rows map to
// the API shape with no boundary cast.

import {
    currentTypeForLegacySource,
    deriveBalancePosition,
    legacyEnergySource
} from '../../model/energy/energyAxes';
import type {
    EnergyCurrentType,
    EnergyLogicalMeter,
    EnergyLogicalMeterMeaning,
    EnergyLogicalMeterPoint,
    EnergyMeterConnection,
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
import {listMeterConnections} from './MeterConnectionRepository';

export interface SaveLogicalMeterDbParams {
    /** null = create, else update that meter within the org. */
    id: number | null;
    org: string;
    name: string;
    utilityType: string;
    role: string;
    kindId: string | null;
    energySource: string | null;
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
    const result = await callMethod('fm.fn_save_logical_meter_axes', {
        p_id: params.id,
        p_org: params.org,
        p_name: params.name,
        p_utility_type: params.utilityType,
        p_role: params.role,
        p_kind_id: params.kindId,
        p_energy_source: params.energySource,
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
    locationId?: number,
    asOf: Date | string = new Date()
): Promise<EnergyLogicalMeter[]> {
    const [result, axesResult, connections] = await Promise.all([
        rawCall('fm.fn_list_logical_meters_at', {
            p_org: org,
            p_group_id: groupId ?? null,
            p_location_id: locationId ?? null,
            p_at: asOf
        }),
        rawCall('fm.fn_list_logical_meter_axes', {p_org: org}),
        listMeterConnections(org)
    ]);
    return mapMeterRows(result, axesResult, connections);
}

export async function listLogicalMeterMeanings(
    org: string,
    from: Date,
    to: Date
): Promise<EnergyLogicalMeterMeaning[]> {
    const result = await rawCall('fm.fn_list_logical_meter_meanings', {
        p_org: org,
        p_from: from,
        p_to: to
    });
    const rows = (result as DbResult)?.rows ?? [];
    if (rows.length >= 10_001) {
        throw new Error(
            'logical-meter meaning history exceeds the 10000-row report limit'
        );
    }
    return rows.map((row) => ({
        meterId: Number(row.meter_id),
        revision: Number(row.revision),
        effectiveFrom: meaningTimestamp(row.effective_from),
        effectiveTo: meaningTimestamp(row.effective_to),
        role: row.role as EnergyLogicalMeterMeaning['role'],
        kindId: (row.kind_id as string | null) ?? null
    }));
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

export async function energySourceBelongsToOrg(
    org: string,
    energySource: string
): Promise<boolean> {
    const rows = await queryRows<{exists: boolean}>(
        `SELECT EXISTS(
            SELECT 1 FROM organization.energy_source
            WHERE id = $1
              AND (organization_id IS NULL OR organization_id = $2)
        ) AS exists`,
        [energySource, org]
    );
    return rows[0]?.exists === true;
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

function mapMeterRows(
    result: unknown,
    axesResult: unknown,
    connections: readonly EnergyMeterConnection[]
): EnergyLogicalMeter[] {
    const rows = (result as DbResult)?.rows ?? [];
    const axes = indexAxes(axesResult);
    const connectionsByMeter = indexConnections(connections);
    return rows.map((r) => {
        const id = Number(r.id);
        const points = mapPoints(r.points, id, axes.currentTypeByPoint);
        return {
            id,
            name: r.name as string,
            utilityType: r.utility_type as EnergyLogicalMeter['utilityType'],
            role: r.role as EnergyLogicalMeter['role'],
            kindId: (r.kind_id as string | null) ?? null,
            meaningRevision: Number(r.meaning_revision ?? 1),
            meaningEffectiveFrom: meaningTimestamp(r.meaning_effective_from),
            energySource:
                axes.energySourceByMeter.get(id) ??
                inferredEnergySource(points),
            balancePosition: deriveBalancePosition(
                connectionsByMeter.get(id) ?? []
            ),
            phaseMode: r.phase_mode as EnergyLogicalMeter['phaseMode'],
            aggregationMode:
                r.aggregation_mode as EnergyLogicalMeter['aggregationMode'],
            parentMeterId: numberOrNull(r.parent_meter_id),
            groupId: numberOrNull(r.group_id),
            locationId: numberOrNull(r.location_id),
            costCenter: (r.cost_center as string | null) ?? null,
            virtualFormula:
                (r.virtual_formula as EnergyVirtualFormula | null) ?? null,
            points
        };
    });
}

function mapPoints(
    value: unknown,
    meterId: number,
    currentTypeByPoint: ReadonlyMap<string, EnergyCurrentType | null>
): EnergyLogicalMeterPoint[] {
    const raw = (value as Record<string, unknown>[] | null) ?? [];
    return raw.map((p) => {
        const deviceId = Number(p.deviceId);
        const channel = Number(p.channel ?? 0);
        const tag = p.tag as EnergyLogicalMeterPoint['tag'];
        const electricalDomain =
            (p.electricalDomain as EnergyLogicalMeterPoint['electricalDomain']) ??
            null;
        return {
            deviceId,
            componentKey: p.componentKey as string,
            channel,
            phase: (p.phase as EnergyLogicalMeterPoint['phase']) ?? 'z',
            tag,
            electricalDomain,
            currentType:
                currentTypeByPoint.get(
                    pointAxisKey(meterId, deviceId, channel, tag)
                ) ?? currentTypeForLegacySource(electricalDomain),
            directionHint:
                (p.directionHint as EnergyLogicalMeterPoint['directionHint']) ??
                null
        };
    });
}

interface AxisIndex {
    energySourceByMeter: Map<number, string | null>;
    currentTypeByPoint: Map<string, EnergyCurrentType | null>;
}

function indexAxes(result: unknown): AxisIndex {
    const energySourceByMeter = new Map<number, string | null>();
    const currentTypeByPoint = new Map<string, EnergyCurrentType | null>();
    for (const row of (result as DbResult)?.rows ?? []) {
        const meterId = Number(row.meter_id);
        energySourceByMeter.set(
            meterId,
            (row.energy_source as string | null) ?? null
        );
        if (row.device == null || row.tag == null) continue;
        currentTypeByPoint.set(
            pointAxisKey(
                meterId,
                Number(row.device),
                Number(row.channel ?? 0),
                String(row.tag)
            ),
            (row.current_type as EnergyCurrentType | null) ?? null
        );
    }
    return {energySourceByMeter, currentTypeByPoint};
}

function indexConnections(
    connections: readonly EnergyMeterConnection[]
): Map<number, EnergyMeterConnection[]> {
    const byMeter = new Map<number, EnergyMeterConnection[]>();
    for (const connection of connections) {
        const meterConnections = byMeter.get(connection.meterId) ?? [];
        meterConnections.push(connection);
        byMeter.set(connection.meterId, meterConnections);
    }
    return byMeter;
}

function pointAxisKey(
    meterId: number,
    deviceId: number,
    channel: number,
    tag: string
): string {
    return `${meterId}|${deviceId}|${channel}|${tag}`;
}

function inferredEnergySource(
    points: readonly EnergyLogicalMeterPoint[]
): string | null {
    for (const point of points) {
        const source = legacyEnergySource(point.electricalDomain);
        if (source !== null) return source;
    }
    return null;
}

function numberOrNull(value: unknown): number | null {
    return value === null || value === undefined ? null : Number(value);
}

function meaningTimestamp(value: unknown): string | null {
    if (value == null || String(value) === '-infinity') return null;
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(date.getTime())) {
        throw new Error('logical-meter meaning timestamp is invalid');
    }
    return date.toISOString();
}
