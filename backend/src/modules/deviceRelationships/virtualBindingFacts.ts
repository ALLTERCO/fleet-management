import type {ShellyDeviceExternal} from '../../types';
import type {RelationshipSummaryDto} from '../../types/api/device';
import type {
    VirtualDeviceDto,
    VirtualDeviceProfileRole
} from '../../types/api/virtualdevice';
import * as DeviceCollector from '../DeviceCollector';
import {
    dedupeVirtualRoles,
    extractionDeviceRelatesToCenter,
    extractionMetadata,
    loadProfileVirtualRoleFacts,
    loadVirtualBindingRows,
    loadVirtualDevices,
    needsVirtualRelationships,
    relatedVirtualExternalIds,
    requiredRoleSeverity,
    virtualBindingStatus,
    virtualRoleKey,
    visibleVirtualBindingRows
} from './deviceLoadingCore';
import {requireOrganization} from './relationshipShared';
import type {
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput,
    VirtualBindingRow,
    VirtualProfileRoleFact,
    VirtualRoleFactInput
} from './relationshipTypes';
import type {
    RelationshipExtractionOriginFact,
    RelationshipProfileReferenceFact,
    RelationshipVirtualBindingFact,
    RelationshipVirtualRoleFact
} from './types';

export async function loadIncludedProfileReferenceFacts(
    input: RelationshipLoadInput
): Promise<RelationshipProfileReferenceFact[]> {
    if (!needsVirtualRelationships(input.includes) || !input.organizationId) {
        return [];
    }
    const scopedInput = requireOrganization(input);
    const devices = await loadVirtualDevices(scopedInput);
    const relatedVirtualIds = await relatedVirtualExternalIds(scopedInput);
    return devices
        .filter((device) => relatedVirtualIds.has(device.externalId))
        .filter((device) => typeof device.profileId === 'string')
        .map((device) => ({
            virtualExternalId: device.externalId,
            profileId: device.profileId as string,
            label: `Profile ${device.profileId}`,
            meta: {
                typeKey: device.typeKey,
                categoryKey: device.categoryKey
            }
        }));
}

export async function loadIncludedExtractionOriginFacts(
    input: RelationshipLoadInput
): Promise<RelationshipExtractionOriginFact[]> {
    if (!input.includes.has('extraction') || !input.organizationId) return [];
    const devices = await loadVirtualDevices(requireOrganization(input));
    return devices
        .filter((device) => extractionDeviceRelatesToCenter({input, device}))
        .flatMap(extractionOriginFact);
}

export async function loadIncludedVirtualRoleFacts(
    input: RelationshipLoadInput
): Promise<RelationshipVirtualRoleFact[]> {
    if (!needsVirtualRelationships(input.includes) || !input.organizationId)
        return [];
    const scopedInput = requireOrganization(input);
    const [bindingRows, profileRoles] = await Promise.all([
        visibleVirtualBindingRows(scopedInput),
        loadProfileVirtualRoleFacts(scopedInput)
    ]);
    return mergeVirtualRoleFacts({bindingRows, profileRoles});
}

export async function loadIncludedVirtualBindingFacts(
    input: RelationshipLoadInput
): Promise<RelationshipVirtualBindingFact[]> {
    if (!needsVirtualRelationships(input.includes) || !input.organizationId)
        return [];
    const scopedInput = requireOrganization(input);
    const rows = await visibleVirtualBindingRows(scopedInput);
    return rows.map((row) => ({
        virtualExternalId: row.virtual_external_id,
        roleKey: row.role_key,
        sourceExternalId: row.source_external_id,
        sourceComponentKey: row.source_component_key,
        status: virtualBindingStatus(row),
        meta: {
            mode: row.mode,
            valueType: row.value_type,
            writable: row.writable,
            required: row.required,
            unit: row.unit
        }
    }));
}

function mergeVirtualRoleFacts(input: {
    bindingRows: readonly VirtualBindingRow[];
    profileRoles: readonly VirtualProfileRoleFact[];
}): RelationshipVirtualRoleFact[] {
    const facts = profileRoleFactMap(input.profileRoles);
    const profileRoles = profileRolesByKey(input.profileRoles);
    for (const row of dedupeVirtualRoles(input.bindingRows)) {
        facts.set(
            virtualRoleKey(row.virtual_external_id, row.role_key),
            virtualBindingRoleFact({
                row,
                profileRole: profileRoles.get(
                    virtualRoleKey(row.virtual_external_id, row.role_key)
                )
            })
        );
    }
    return [...facts.values()].sort(compareVirtualRoleFacts);
}

function profileRoleFactMap(
    roles: readonly VirtualProfileRoleFact[]
): Map<string, RelationshipVirtualRoleFact> {
    const facts = new Map<string, RelationshipVirtualRoleFact>();
    for (const role of roles) {
        facts.set(virtualRoleKey(role.virtualExternalId, role.role.roleKey), {
            virtualExternalId: role.virtualExternalId,
            roleKey: role.role.roleKey,
            label: profileRoleLabel(role.role),
            status: missingProfileRoleStatus(role.role),
            meta: profileRoleMeta(role)
        });
    }
    return facts;
}

function profileRolesByKey(
    roles: readonly VirtualProfileRoleFact[]
): Map<string, VirtualProfileRoleFact> {
    const byKey = new Map<string, VirtualProfileRoleFact>();
    for (const role of roles) {
        byKey.set(
            virtualRoleKey(role.virtualExternalId, role.role.roleKey),
            role
        );
    }
    return byKey;
}

function virtualBindingRoleFact(
    input: VirtualRoleFactInput
): RelationshipVirtualRoleFact {
    return {
        virtualExternalId: input.row.virtual_external_id,
        roleKey: input.row.role_key,
        label: roleLabel(input),
        status: virtualBindingStatus(input.row),
        meta: {
            ...profileRoleMeta(input.profileRole),
            mode: input.row.mode,
            valueType: input.row.value_type,
            writable: input.row.writable,
            required: input.row.required,
            unit: input.row.unit
        }
    };
}

function compareVirtualRoleFacts(
    left: RelationshipVirtualRoleFact,
    right: RelationshipVirtualRoleFact
): number {
    return (
        left.virtualExternalId.localeCompare(right.virtualExternalId) ||
        left.roleKey.localeCompare(right.roleKey)
    );
}

function roleLabel(input: VirtualRoleFactInput): string {
    const displayName = input.row.role_metadata_json?.displayName;
    if (typeof displayName === 'string' && displayName.trim()) {
        return displayName;
    }
    if (input.profileRole) return profileRoleLabel(input.profileRole.role);
    return input.row.role_key;
}

function profileRoleLabel(role: VirtualDeviceProfileRole): string {
    return role.visual?.displayName ?? role.label ?? role.roleKey;
}

function missingProfileRoleStatus(
    role: VirtualDeviceProfileRole
): RelationshipVirtualRoleFact['status'] {
    return role.required === false ? 'warning' : 'critical';
}

function profileRoleMeta(
    roleFact: VirtualProfileRoleFact | undefined
): Record<string, unknown> {
    if (!roleFact) return {};
    const {role} = roleFact;
    return {
        profileId: roleFact.profileId,
        valueType: role.valueType,
        writable: role.writable ?? null,
        required: role.required ?? true,
        unit: role.unit ?? null,
        historyMode: role.historyMode,
        visual: role.visual ?? null
    };
}

function extractionOriginFact(
    device: VirtualDeviceDto
): RelationshipExtractionOriginFact[] {
    const extraction = extractionMetadata(device);
    if (!extraction) return [];
    return [
        {
            extractedExternalId: device.externalId,
            sourceHostExternalId: extraction.sourceHostExternalId,
            sourceHostLabel: extraction.sourceHostExternalId,
            sourceKey: extraction.sourceKey,
            sourceType: extraction.sourceType,
            status: 'unknown',
            meta: {
                capturedAt: extraction.capturedAt,
                hiddenSourceComponentKeys: extraction.hiddenSourceComponentKeys
            }
        }
    ];
}

export async function loadVirtualSourceHealthSummaries(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipSummaryDto[]> {
    if (!needsVirtualRelationships(input.includes)) return [];
    const rows = await visibleVirtualBindingRows(input);
    return rows.flatMap(virtualSourceHealthSummary);
}

function virtualSourceHealthSummary(
    row: VirtualBindingRow
): RelationshipSummaryDto[] {
    const source = DeviceCollector.getDevice(row.source_external_id);
    if (!source || source.presence === 'online') return [];
    return [virtualSourceUnavailableSummary({row, presence: source.presence})];
}

function virtualSourceUnavailableSummary(input: {
    row: VirtualBindingRow;
    presence: ShellyDeviceExternal['presence'];
}): RelationshipSummaryDto {
    const severity = requiredRoleSeverity(input.row);
    const reasonCode =
        input.presence === 'offline'
            ? virtualSourceOfflineReasonCode(input.row)
            : 'virtual_source_pending';
    return {
        severity,
        text: `${virtualRoleRequirementLabel(input.row)} virtual source ${input.row.source_external_id} for role ${input.row.role_key} on ${input.row.virtual_external_id} is ${input.presence}.`,
        nodeIds: [
            `device:${input.row.virtual_external_id}`,
            `role:${input.row.virtual_external_id}:${input.row.role_key}`,
            `device:${input.row.source_external_id}`
        ],
        reasonCode
    };
}

function virtualSourceOfflineReasonCode(row: VirtualBindingRow): string {
    return row.required === false
        ? 'virtual_optional_source_offline'
        : 'virtual_required_source_offline';
}

function virtualRoleRequirementLabel(row: VirtualBindingRow): string {
    return row.required === false ? 'Optional' : 'Required';
}

export async function loadMissingRequiredVirtualRoleSummaries(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipSummaryDto[]> {
    if (!needsVirtualRelationships(input.includes)) return [];
    const [bindings, profileRoles] = await Promise.all([
        loadVirtualBindingRows(input),
        loadProfileVirtualRoleFacts(input)
    ]);
    const boundRoles = boundVirtualRoleKeys(bindings);
    return profileRoles
        .filter(requiredProfileRole)
        .filter((role) => !boundRoles.has(profileVirtualRoleKey(role)))
        .map(missingRequiredVirtualRoleSummary);
}

function boundVirtualRoleKeys(rows: readonly VirtualBindingRow[]): Set<string> {
    return new Set(
        rows.map((row) => virtualRoleKey(row.virtual_external_id, row.role_key))
    );
}

function requiredProfileRole(role: VirtualProfileRoleFact): boolean {
    return role.role.required !== false;
}

function profileVirtualRoleKey(role: VirtualProfileRoleFact): string {
    return virtualRoleKey(role.virtualExternalId, role.role.roleKey);
}

function missingRequiredVirtualRoleSummary(
    role: VirtualProfileRoleFact
): RelationshipSummaryDto {
    const label = profileRoleLabel(role.role);
    return {
        severity: 'critical',
        text: `Required virtual role ${label} on ${role.virtualExternalId} has no active source binding.`,
        nodeIds: [
            `device:${role.virtualExternalId}`,
            `role:${role.virtualExternalId}:${role.role.roleKey}`
        ],
        reasonCode: 'virtual_required_source_missing'
    };
}

export async function loadExtractionSummaries(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipSummaryDto[]> {
    if (!input.includes.has('extraction')) return [];
    const devices = await loadVirtualDevices(input);
    return devices
        .filter((device) => device.externalId === input.centerExternalId)
        .filter((device) => device.kind === 'extracted')
        .filter((device) => !extractionMetadata(device))
        .map((device) => ({
            severity: 'warning' as const,
            text: `Extracted device ${device.externalId} has no usable extraction origin metadata.`,
            nodeIds: [`device:${device.externalId}`],
            reasonCode: 'extraction_origin_unknown'
        }));
}
