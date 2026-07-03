import {getDeviceCostCenter} from '../device/deviceKindRepository';
import {getDeviceDecoration} from '../device/imageOverrideRepository';
import * as postgres from '../PostgresProvider';
import {requireOrganization} from './relationshipShared';
import type {
    AssignmentGrantRow,
    EnergyClassificationRow,
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput
} from './relationshipTypes';
import type {
    RelationshipAssignmentGrantFact,
    RelationshipCostCenterFact,
    RelationshipEnergyClassificationFact,
    RelationshipVisualAssetFact
} from './types';

export async function loadIncludedVisualAssetFacts(
    input: RelationshipLoadInput
): Promise<RelationshipVisualAssetFact[]> {
    if (!input.includes.has('visuals') || !input.organizationId) return [];
    const {imageAssetId} = await getDeviceDecoration(
        input.organizationId,
        input.centerExternalId
    );
    if (!imageAssetId) return [];
    return [
        {
            ownerExternalId: input.centerExternalId,
            assetId: imageAssetId,
            label: 'Visual asset'
        }
    ];
}

export async function loadIncludedCostCenterFacts(
    input: RelationshipLoadInput
): Promise<RelationshipCostCenterFact[]> {
    if (!input.includes.has('costCenter') || !input.organizationId) return [];
    const costCenter = await loadCenterCostCenter(requireOrganization(input));
    if (!costCenter) return [];
    return [
        {
            deviceExternalId: input.centerExternalId,
            costCenter,
            label: costCenter
        }
    ];
}

// The center device's billing cost center, stored on device.list.
async function loadCenterCostCenter(
    input: OrganizationRelationshipLoadInput
): Promise<string | null> {
    const load = () =>
        getDeviceCostCenter(input.centerExternalId, input.organizationId);
    if (!input.cache) return await load();
    input.cache.costCenter ??= load();
    return await input.cache.costCenter;
}

export async function loadIncludedEnergyClassificationFacts(
    input: RelationshipLoadInput
): Promise<RelationshipEnergyClassificationFact[]> {
    if (!input.includes.has('energyClassification') || !input.organizationId) {
        return [];
    }
    const rows = await queryEnergyClassifications(requireOrganization(input));
    return rows.map((row) => ({
        deviceExternalId: input.centerExternalId,
        componentKey: row.component_key,
        tag: row.tag,
        domain: row.domain,
        channel: row.channel
    }));
}

async function queryEnergyClassifications(
    input: OrganizationRelationshipLoadInput
): Promise<EnergyClassificationRow[]> {
    return await postgres.queryRows<EnergyClassificationRow>(
        `SELECT
            ec.component_key,
            ec.tag,
            ec.domain,
            ec.channel
           FROM fm.energy_classification ec
           JOIN device.list dl
             ON dl.id = ec.device
            AND dl.organization_id = $1
          WHERE dl.external_id = $2
          ORDER BY ec.component_key ASC
          LIMIT 200`,
        [input.organizationId, input.centerExternalId]
    );
}

export async function loadIncludedAssignmentGrantFacts(
    input: RelationshipLoadInput
): Promise<RelationshipAssignmentGrantFact[]> {
    if (
        !input.includes.has('accessGrants') ||
        !input.organizationId ||
        !input.permissions.accessGrantsRead
    ) {
        return [];
    }
    const rows = await queryAssignmentGrants(requireOrganization(input));
    return rows.map((row) => assignmentGrantFact({input, row}));
}

async function queryAssignmentGrants(
    input: OrganizationRelationshipLoadInput
): Promise<AssignmentGrantRow[]> {
    const result = await postgres.callMethod(
        'organization.fn_assignment_list_for_resource',
        {
            p_tenant_id: input.organizationId,
            p_scope_probe: JSON.stringify({
                device_ids: [input.centerExternalId]
            })
        }
    );
    return (result?.rows ?? []) as AssignmentGrantRow[];
}

function assignmentGrantFact(input: {
    input: RelationshipLoadInput;
    row: AssignmentGrantRow;
}): RelationshipAssignmentGrantFact {
    return {
        id: input.row.id,
        label: `${input.row.subject_type} grant`,
        subjectType: input.row.subject_type,
        subjectId: input.row.subject_id,
        personaId: input.row.persona_id,
        targetExternalId: input.input.centerExternalId
    };
}
