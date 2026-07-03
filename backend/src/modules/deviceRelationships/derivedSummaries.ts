import type {RelationshipSummaryDto} from '../../types/api/device';
import {loadBluetoothRelationshipSummaries} from './bluetoothFacts';
import {relatedConnectorExternalIds} from './deviceLoadingCore';
import {loadLiveDeviceSidePartialSummaries} from './deviceSideRelationships';
import {loadConnectorRelationshipSummaries as loadConnectorRelationshipSummariesFromRepository} from './relationshipConnectorRepository';
import {loadDashboardRelationshipSummaries} from './relationshipDashboardRepository';
import {
    certificateHealthSummary,
    certificateNeedsAttention,
    operationHealthSummary,
    operationNeedsAttention
} from './relationshipHealth';
import {loadIncludedOperationJobFacts} from './relationshipOperationRepository';
import {loadIncludedCertificateFacts} from './relationshipSecurityRepository';
import {requireOrganization} from './relationshipShared';
import type {
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput
} from './relationshipTypes';
import {
    loadExtractionSummaries,
    loadMissingRequiredVirtualRoleSummaries,
    loadVirtualSourceHealthSummaries
} from './virtualBindingFacts';

export async function loadDerivedRelationshipSummaries(
    input: RelationshipLoadInput
): Promise<RelationshipSummaryDto[]> {
    if (!input.organizationId) return [];
    return [
        ...(await loadBluetoothRelationshipSummaries(
            requireOrganization(input)
        )),
        ...(await loadDashboardRelationshipSummaries(
            requireOrganization(input)
        )),
        ...(await loadVirtualSourceHealthSummaries(requireOrganization(input))),
        ...(await loadMissingRequiredVirtualRoleSummaries(
            requireOrganization(input)
        )),
        ...(await loadOperationRelationshipSummaries(
            requireOrganization(input)
        )),
        ...(await loadCertificateRelationshipSummaries(
            requireOrganization(input)
        )),
        ...(await loadExtractionSummaries(requireOrganization(input))),
        ...(await loadConnectorRelationshipSummariesFromRepository({
            relationship: input,
            relatedExternalIds: () =>
                relatedConnectorExternalIds(requireOrganization(input))
        })),
        ...loadLiveDeviceSidePartialSummaries(input)
    ];
}

async function loadOperationRelationshipSummaries(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipSummaryDto[]> {
    const facts = await loadIncludedOperationJobFacts(input);
    return facts.filter(operationNeedsAttention).map(operationHealthSummary);
}

async function loadCertificateRelationshipSummaries(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipSummaryDto[]> {
    const facts = await loadIncludedCertificateFacts(input);
    return facts
        .filter(certificateNeedsAttention)
        .map(certificateHealthSummary);
}
