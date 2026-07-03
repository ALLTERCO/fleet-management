import type {EnergyDomain, EnergyTag} from '../modules/energyClassifier';
import {
    callMethod,
    type DbResult,
    queryRows
} from '../modules/PostgresProvider';
import {
    type NormalizedRemapEntry,
    validateConfirmedMapping
} from './deviceReplacementMapping';

// Types live in a leaf module so the mapping validator can share them without
// importing this file back (no cycle). Re-exported for existing callers.
export type {
    DeviceReplacementAvailablePoint,
    DeviceReplacementCandidate,
    DeviceReplacementCheckResult,
    DeviceReplacementPoint,
    DeviceReplacementRequirement,
    ReplacementCompatibility
} from './deviceReplacementTypes';

import type {
    DeviceReplacementAvailablePoint,
    DeviceReplacementCandidate,
    DeviceReplacementCheckResult,
    DeviceReplacementRequirement
} from './deviceReplacementTypes';
import {
    deviceMeasurementPoints,
    type MeasurementPointFact,
    type MeasurementPointSource
} from './energy/measurementPoints';

interface DeviceRow {
    id: number;
    external_id: string;
    organization_id: string | null;
    jdoc: Record<string, unknown> | null;
}

interface HistoryRow {
    channel: number | null;
    phase: 'a' | 'b' | 'c' | 'z';
    tag: EnergyTag;
    electrical_domain: EnergyDomain | null;
}

export interface CheckReplacementInput {
    organizationId: string;
    oldShellyID: string;
    newShellyID: string;
    snapshotForShellyID?: (
        shellyID: string
    ) => MeasurementPointSource | undefined;
}

export async function checkReplacement(
    input: CheckReplacementInput
): Promise<DeviceReplacementCheckResult> {
    const {oldRow, newRow} = await loadReplacementRows(input);
    const requirements = await loadRequirements(oldRow.id);
    const available = await loadAvailablePoints(newRow, input);
    const compared = compareReplacementPoints(requirements, available);
    return {
        oldShellyID: input.oldShellyID,
        newShellyID: input.newShellyID,
        oldDeviceId: oldRow.id,
        newDeviceId: newRow.id,
        requirements,
        available,
        ...compared
    };
}

export interface ReplaceHardwareInput extends CheckReplacementInput {
    confirmedMapping?: unknown;
    confirmedBy?: string | null;
}

export async function replaceHardware(input: ReplaceHardwareInput): Promise<{
    deviceId: number;
    oldShellyID: string;
    newShellyID: string;
    auditId: number;
}> {
    const check = await checkReplacement(input);
    if (check.compatibility === 'incompatible') {
        throw new Error('replacement is incompatible');
    }
    // Exact match needs no remap; a compatible mapping must be confirmed and
    // validated against the candidates before any DB write — fail loud here.
    let normalizedMapping: NormalizedRemapEntry[] = [];
    if (check.compatibility === 'compatible_mapping') {
        if (input.confirmedMapping === undefined) {
            throw new Error(
                'replacement requires a confirmedMapping for the remapped points'
            );
        }
        normalizedMapping = validateConfirmedMapping(
            check.remapCandidates,
            input.confirmedMapping
        );
    }
    const result = (await callMethod('device.fn_replace_hardware', {
        p_organization_id: input.organizationId,
        p_old_external_id: input.oldShellyID,
        p_new_external_id: input.newShellyID,
        p_confirmed_by: input.confirmedBy ?? null,
        p_compatibility: check.compatibility,
        p_mapping: JSON.stringify(normalizedMapping)
    })) as DbResult;
    const row = result.rows?.[0] as
        | {
              device_id: number;
              old_external_id: string;
              new_external_id: string;
              audit_id: string | number;
          }
        | undefined;
    if (!row) throw new Error('replacement did not return an audit row');
    return {
        deviceId: row.device_id,
        oldShellyID: row.old_external_id,
        newShellyID: row.new_external_id,
        auditId: Number(row.audit_id)
    };
}

export function compareReplacementPoints(
    requirements: readonly DeviceReplacementRequirement[],
    available: readonly DeviceReplacementAvailablePoint[]
): Pick<
    DeviceReplacementCheckResult,
    'compatibility' | 'missing' | 'remapCandidates' | 'warnings'
> {
    const missing: DeviceReplacementRequirement[] = [];
    const remapCandidates: DeviceReplacementCandidate[] = [];
    const warnings: string[] = [];
    for (const req of requirements) {
        if (available.some((point) => exactPointMatch(req, point))) continue;
        const candidates = available.filter((point) =>
            compatiblePointMatch(req, point)
        );
        if (candidates.length > 0) {
            remapCandidates.push({required: req, candidates});
        } else {
            missing.push(req);
        }
    }
    if (requirements.length === 0) {
        warnings.push('old device has no logical-meter point usage');
    }
    if (missing.length > 0) {
        return {
            compatibility: 'incompatible',
            missing,
            remapCandidates,
            warnings
        };
    }
    if (remapCandidates.length > 0) {
        return {
            compatibility: 'compatible_mapping',
            missing,
            remapCandidates,
            warnings
        };
    }
    return {
        compatibility: 'exact_match',
        missing,
        remapCandidates,
        warnings
    };
}

async function loadReplacementRows(input: CheckReplacementInput): Promise<{
    oldRow: DeviceRow;
    newRow: DeviceRow;
}> {
    if (!input.organizationId) throw new Error('organization is required');
    if (input.oldShellyID === input.newShellyID) {
        throw new Error('oldShellyID and newShellyID must differ');
    }
    const rows = await queryRows<DeviceRow>(
        `SELECT id, external_id, organization_id, jdoc
           FROM device.list
          WHERE organization_id = $1
            AND external_id = ANY($2::varchar[])`,
        [input.organizationId, [input.oldShellyID, input.newShellyID]]
    );
    const oldRow = rows.find((row) => row.external_id === input.oldShellyID);
    const newRow = rows.find((row) => row.external_id === input.newShellyID);
    if (!oldRow) throw new Error(`old device ${input.oldShellyID} not found`);
    if (!newRow) throw new Error(`new device ${input.newShellyID} not found`);
    return {oldRow, newRow};
}

async function loadRequirements(
    oldDeviceId: number
): Promise<DeviceReplacementRequirement[]> {
    const rows = await queryRows<
        DeviceReplacementRequirement & {
            logical_meter_id: number;
            logical_meter_name: string;
            utility_type: string;
            electrical_domain: EnergyDomain | null;
        }
    >(
        `SELECT
             p.channel,
             p.phase,
             p.tag,
             p.electrical_domain,
             m.id AS logical_meter_id,
             m.name AS logical_meter_name,
             m.utility_type,
             m.role
           FROM fm.logical_meter_point p
           JOIN fm.logical_meter m ON m.id = p.logical_meter_id
          WHERE p.device = $1
          ORDER BY m.id, p.channel, p.phase, p.tag`,
        [oldDeviceId]
    );
    return rows.map((row) => ({
        channel: row.channel,
        phase: row.phase,
        tag: row.tag,
        electricalDomain: row.electrical_domain,
        logicalMeterId: Number(row.logical_meter_id),
        logicalMeterName: row.logical_meter_name,
        utilityType: row.utility_type,
        role: row.role
    }));
}

async function loadAvailablePoints(
    newRow: DeviceRow,
    input: CheckReplacementInput
): Promise<DeviceReplacementAvailablePoint[]> {
    const historyRows = await callMethod(
        'device_em.fn_list_measurement_points',
        {
            p_devices: [newRow.id]
        }
    );
    const history = ((historyRows as DbResult).rows ?? []).map((row) => {
        const r = row as unknown as HistoryRow;
        return {
            channel: Number(r.channel ?? 0),
            phase: r.phase,
            tag: r.tag,
            electricalDomain: r.electrical_domain,
            source: 'history',
            componentKey: null
        } satisfies DeviceReplacementAvailablePoint;
    });
    const snapshot =
        input.snapshotForShellyID?.(input.newShellyID) ??
        snapshotFromJdoc(newRow.jdoc);
    const live = deviceMeasurementPoints(snapshot).map(livePoint);
    return dedupeAvailable([...history, ...live]);
}

function snapshotFromJdoc(
    jdoc: Record<string, unknown> | null
): MeasurementPointSource {
    return {
        status: asRecord(jdoc?.status),
        config: asRecord(jdoc?.settings)
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

function livePoint(
    point: MeasurementPointFact
): DeviceReplacementAvailablePoint {
    return {
        channel: point.channel,
        phase: point.phase,
        tag: point.tag,
        electricalDomain: point.electricalDomain,
        source: 'live',
        componentKey: point.componentKey
    };
}

function dedupeAvailable(
    points: readonly DeviceReplacementAvailablePoint[]
): DeviceReplacementAvailablePoint[] {
    const out = new Map<string, DeviceReplacementAvailablePoint>();
    for (const point of points) {
        const key = `${point.channel}|${point.phase}|${point.tag}|${point.electricalDomain ?? ''}`;
        const existing = out.get(key);
        if (!existing || existing.source === 'history') out.set(key, point);
    }
    return [...out.values()];
}

function exactPointMatch(
    req: DeviceReplacementRequirement,
    point: DeviceReplacementAvailablePoint
): boolean {
    return (
        req.channel === point.channel &&
        req.phase === point.phase &&
        compatiblePointMatch(req, point)
    );
}

function compatiblePointMatch(
    req: DeviceReplacementRequirement,
    point: DeviceReplacementAvailablePoint
): boolean {
    return (
        req.tag === point.tag &&
        req.phase === point.phase &&
        (req.electricalDomain === null ||
            point.electricalDomain === null ||
            req.electricalDomain === point.electricalDomain)
    );
}
