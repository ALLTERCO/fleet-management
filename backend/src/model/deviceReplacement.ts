import * as EventDistributor from '../modules/EventDistributor';
import type {EnergyDomain, EnergyTag} from '../modules/energyClassifier';
import {
    callMethod,
    type DbResult,
    queryRows
} from '../modules/PostgresProvider';
import {resolveRoleProjection} from '../modules/virtualDevice/roleProjection';
import {
    classifySourceComponent,
    collectBindableComponentKeys
} from '../modules/virtualDevice/sourceClassifier';
import {
    type NormalizedBindingRemapEntry,
    type NormalizedRemapEntry,
    validateConfirmedBindingMapping,
    validateConfirmedMapping
} from './deviceReplacementMapping';

// Types live in a leaf module so the mapping validator can share them without
// importing this file back (no cycle). Re-exported for existing callers.
export type {
    DeviceReplacementAvailablePoint,
    DeviceReplacementBindingCandidate,
    DeviceReplacementBindingRequirement,
    DeviceReplacementBindingTarget,
    DeviceReplacementCandidate,
    DeviceReplacementCheckResult,
    DeviceReplacementPoint,
    DeviceReplacementRequirement,
    ReplacementCompatibility
} from './deviceReplacementTypes';

import type {VirtualDeviceHistoryMode} from '../types/api/virtualdevice';
import type {
    DeviceReplacementAvailablePoint,
    DeviceReplacementBindingCandidate,
    DeviceReplacementBindingRequirement,
    DeviceReplacementBindingTarget,
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
    candidate_fingerprint: string;
}

interface HistoryRow {
    channel: number | null;
    phase: 'a' | 'b' | 'c' | 'z';
    tag: EnergyTag;
    domain: EnergyDomain;
}

export interface CheckReplacementInput {
    organizationId: string;
    oldShellyID: string;
    newShellyID: string;
}

export async function checkReplacement(
    input: CheckReplacementInput
): Promise<DeviceReplacementCheckResult> {
    return (await inspectReplacement(input)).check;
}

async function inspectReplacement(input: CheckReplacementInput): Promise<{
    check: DeviceReplacementCheckResult;
    requirementsFingerprint: string;
    candidateFingerprint: string;
}> {
    const {oldRow, newRow} = await loadReplacementRows(input);
    const requirementsSnapshot = await loadRequirements(oldRow.id);
    const {requirements} = requirementsSnapshot;
    const bindingRequirements = await loadBindingRequirements(oldRow.id);
    const available = await loadAvailablePoints(newRow);
    const compared = compareReplacementPoints(requirements, available);
    const bindingComparison = compareBindingRequirements(
        bindingRequirements,
        newRow
    );
    return {
        check: {
            oldShellyID: input.oldShellyID,
            newShellyID: input.newShellyID,
            oldDeviceId: oldRow.id,
            newDeviceId: newRow.id,
            requirements,
            available,
            ...compared,
            compatibility:
                bindingComparison.missing.length > 0
                    ? 'incompatible'
                    : bindingComparison.remapCandidates.length > 0 &&
                        compared.compatibility === 'exact_match'
                      ? 'compatible_mapping'
                      : compared.compatibility,
            bindingRequirements,
            missingBindings: bindingComparison.missing,
            bindingRemapCandidates: bindingComparison.remapCandidates
        },
        requirementsFingerprint: requirementsSnapshot.fingerprint,
        candidateFingerprint: newRow.candidate_fingerprint
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
    const inspection = await inspectReplacement(input);
    const {check} = inspection;
    if (check.compatibility === 'incompatible') {
        throw new Error('replacement is incompatible');
    }
    // Exact match needs no remap; a compatible mapping must be confirmed and
    // validated against the candidates before any DB write — fail loud here.
    let normalizedMapping: NormalizedRemapEntry[] = [];
    let normalizedBindingMapping: NormalizedBindingRemapEntry[] = [];
    if (check.compatibility === 'compatible_mapping') {
        if (input.confirmedMapping === undefined) {
            throw new Error(
                'replacement requires a confirmedMapping for the remapped points'
            );
        }
        const split = splitConfirmedMapping(input.confirmedMapping);
        normalizedMapping = validateConfirmedMapping(
            check.remapCandidates,
            split.points
        );
        normalizedBindingMapping = validateConfirmedBindingMapping(
            check.bindingRemapCandidates,
            split.bindings
        );
    }
    const {withDeviceIdentityChange} = await import(
        '../modules/deviceIdentityRuntime.js'
    );
    const result = await withDeviceIdentityChange(
        input.oldShellyID,
        input.newShellyID,
        async () =>
            (await callMethod('device.fn_replace_hardware', {
                p_organization_id: input.organizationId,
                p_old_external_id: input.oldShellyID,
                p_new_external_id: input.newShellyID,
                p_confirmed_by: input.confirmedBy ?? null,
                p_compatibility: check.compatibility,
                p_mapping: JSON.stringify(normalizedMapping),
                p_requirements_fingerprint: inspection.requirementsFingerprint,
                p_binding_mapping: JSON.stringify(normalizedBindingMapping),
                p_candidate_fingerprint: inspection.candidateFingerprint
            })) as DbResult
    );
    const row = result.rows?.[0] as
        | {
              device_id: number;
              old_external_id: string;
              new_external_id: string;
              audit_id: string | number;
          }
        | undefined;
    if (!row) throw new Error('replacement did not return an audit row');
    // The access cache indexes groups/location/tags by shellyID and is gated on
    // the organization access version, not a TTL. The swap keeps device.list.id
    // but rewrites external_id, so without this bump a restricted caller sees
    // the new shellyID with no membership and `scope: ALL` still lists the old
    // one.
    EventDistributor.invalidateOrganizationAccess(input.organizationId);
    const {invalidateDefaultEnergyRepository} = await import(
        '../modules/repositories/EnergyRepository.js'
    );
    await invalidateDefaultEnergyRepository();
    return {
        deviceId: row.device_id,
        oldShellyID: row.old_external_id,
        newShellyID: row.new_external_id,
        auditId: Number(row.audit_id)
    };
}

function splitConfirmedMapping(value: unknown): {
    points: Record<string, unknown>;
    bindings: Record<string, unknown>;
} {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('confirmedMapping must be an object');
    }
    const points: Record<string, unknown> = {};
    const bindings: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
        value as Record<string, unknown>
    )) {
        if (key.startsWith('binding:')) bindings[key] = entry;
        else points[key] = entry;
    }
    return {points, bindings};
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
        `SELECT id, external_id, organization_id, jdoc,
                device.fn_hardware_candidate_fingerprint(id) AS candidate_fingerprint
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

async function loadRequirements(oldDeviceId: number): Promise<{
    requirements: DeviceReplacementRequirement[];
    fingerprint: string;
}> {
    const rows = await queryRows<{
        requirements: DeviceReplacementRequirement[];
        fingerprint: string;
    }>(
        `WITH requirements AS (
             SELECT jsonb_build_object(
                        'channel', p.channel,
                        'phase', p.phase,
                        'tag', p.tag,
                        'electricalDomain', p.electrical_domain,
                        'logicalMeterId', m.id,
                        'logicalMeterName', m.name,
                        'utilityType', m.utility_type,
                        'role', m.role
                    ) AS requirement
               FROM fm.logical_meter_point p
               JOIN fm.logical_meter m ON m.id = p.logical_meter_id
              WHERE p.device = $1
              ORDER BY m.id, p.channel, p.phase, p.tag
         )
         SELECT COALESCE(jsonb_agg(requirement), '[]'::jsonb) AS requirements,
                device.fn_hardware_requirements_fingerprint($1) AS fingerprint
           FROM requirements`,
        [oldDeviceId]
    );
    const snapshot = rows[0];
    if (!snapshot?.fingerprint) {
        throw new Error('could not snapshot hardware replacement requirements');
    }
    return snapshot;
}

interface BindingRequirementRow {
    id: string;
    virtual_device_list_id: number;
    role_key: string;
    source_component_key: string;
    value_type: string | null;
    unit: string | null;
    source_snapshot_json: Record<string, unknown> | null;
    role_metadata_json: Record<string, unknown> | null;
    transform_json: Record<string, unknown> | null;
    mode: VirtualDeviceHistoryMode;
}

async function loadBindingRequirements(
    oldDeviceId: number
): Promise<DeviceReplacementBindingRequirement[]> {
    const rows = await queryRows<BindingRequirementRow>(
        `SELECT id,
                virtual_device_list_id,
                role_key,
                source_component_key,
                value_type,
                unit,
                source_snapshot_json,
                role_metadata_json,
                transform_json,
                mode
           FROM device.virtual_device_binding
          WHERE source_device_list_id = $1
            AND effective_to IS NULL
            AND effective_from <= NOW()
          ORDER BY virtual_device_list_id, role_key, id`,
        [oldDeviceId]
    );
    return rows.map(bindingRequirementFromRow);
}

function bindingRequirementFromRow(
    row: BindingRequirementRow
): DeviceReplacementBindingRequirement {
    const projection = resolveRoleProjection({
        roleKey: row.role_key,
        sourceComponentKey: row.source_component_key,
        mode: row.mode,
        unit: row.unit,
        valueType: row.value_type,
        sourceSnapshot: row.source_snapshot_json,
        roleMetadata: row.role_metadata_json,
        transformJson: row.transform_json
    });
    return {
        bindingId: row.id,
        virtualDeviceListId: row.virtual_device_list_id,
        roleKey: row.role_key,
        componentKey: row.source_component_key,
        componentType:
            stringField(row.source_snapshot_json, 'componentType') ??
            componentType(row.source_component_key),
        valueType: row.value_type,
        unit: canonicalUnit(row.unit),
        series: projection.series,
        valuePath: projection.valuePath,
        field: projection.field,
        sensorSource: projection.sensorSource ?? null,
        commodity: projection.commodity ?? null,
        electricalSource: projection.electricalSource ?? null,
        transform: projection.transform,
        objectId: numberField(row.source_snapshot_json, 'objectId')
    };
}

export function incompatibleBindingRequirements(
    requirements: readonly DeviceReplacementBindingRequirement[],
    newDevice: Pick<DeviceRow, 'external_id' | 'jdoc'>
): DeviceReplacementBindingRequirement[] {
    return compareBindingRequirements(requirements, newDevice).missing;
}

export function compareBindingRequirements(
    requirements: readonly DeviceReplacementBindingRequirement[],
    newDevice: Pick<DeviceRow, 'external_id' | 'jdoc'>
): {
    missing: DeviceReplacementBindingRequirement[];
    remapCandidates: DeviceReplacementBindingCandidate[];
} {
    const jdoc = newDevice.jdoc ?? {};
    const componentKeys = collectBindableComponentKeys({jdoc});
    const missing: DeviceReplacementBindingRequirement[] = [];
    const remapCandidates: DeviceReplacementBindingCandidate[] = [];
    for (const requirement of requirements) {
        const exact = bindingTarget(
            requirement,
            newDevice.external_id,
            jdoc,
            requirement.componentKey
        );
        if (exact) continue;
        const candidates = componentKeys
            .filter((key) => key !== requirement.componentKey)
            .map((key) =>
                bindingTarget(requirement, newDevice.external_id, jdoc, key)
            )
            .filter((target): target is DeviceReplacementBindingTarget =>
                Boolean(target)
            );
        if (candidates.length === 0) missing.push(requirement);
        else remapCandidates.push({required: requirement, candidates});
    }
    return {missing, remapCandidates};
}

function bindingTarget(
    requirement: DeviceReplacementBindingRequirement,
    deviceExternalId: string,
    jdoc: Record<string, unknown>,
    componentKey: string
): DeviceReplacementBindingTarget | null {
    const keys = collectBindableComponentKeys({jdoc});
    if (!keys.includes(componentKey)) return null;
    const classified = classifySourceComponent({
        deviceExternalId,
        jdoc,
        componentKey
    });
    const sourceSnapshot = {
        componentType: classified.componentType,
        ...(classified.objectId == null ? {} : {objectId: classified.objectId}),
        ...classified.sourceHints
    };
    const projection = resolveRoleProjection({
        roleKey: requirement.roleKey,
        sourceComponentKey: componentKey,
        unit: classified.unit ?? requirement.unit,
        valueType: classified.roleValueType,
        sourceSnapshot,
        transformJson: requirement.transform
    });
    const compatible =
        classified.componentType === requirement.componentType &&
        classified.roleValueType === requirement.valueType &&
        (classified.unit === undefined ||
            canonicalUnit(classified.unit) === requirement.unit) &&
        projection.series === requirement.series &&
        projection.valuePath === requirement.valuePath &&
        projection.field === requirement.field &&
        (projection.sensorSource ?? null) === requirement.sensorSource &&
        (projection.commodity ?? null) === requirement.commodity &&
        (projection.electricalSource ?? null) ===
            requirement.electricalSource &&
        sameJson(projection.transform, requirement.transform) &&
        (classified.objectId ?? null) === requirement.objectId;
    return compatible
        ? {
              componentKey,
              componentType: classified.componentType,
              valueType: classified.roleValueType,
              unit: canonicalUnit(classified.unit ?? requirement.unit),
              objectId: classified.objectId ?? null,
              sourceSnapshot
          }
        : null;
}

function canonicalUnit(value: string | null | undefined): string | null {
    const normalized = value?.trim().toLowerCase();
    return normalized ? normalized : null;
}

function componentType(componentKey: string): string {
    return componentKey.split(':', 1)[0] ?? componentKey;
}

function stringField(
    value: Record<string, unknown> | null,
    key: string
): string | null {
    const field = value?.[key];
    return typeof field === 'string' && field.trim() ? field : null;
}

function numberField(
    value: Record<string, unknown> | null,
    key: string
): number | null {
    const field = value?.[key];
    return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function loadAvailablePoints(
    newRow: DeviceRow
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
            electricalDomain: r.domain,
            source: 'history',
            componentKey: null
        } satisfies DeviceReplacementAvailablePoint;
    });
    // Replacement uses the durable database snapshot as its authoritative
    // live component source. The candidate fingerprint is computed from this
    // same jdoc plus retained measurement-point identities under transaction
    // locks, so Check and Replace cannot validate different source models.
    const snapshot = snapshotFromJdoc(newRow.jdoc);
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
