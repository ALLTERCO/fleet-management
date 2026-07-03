import {loadIncludedAlertRuleFacts} from './alertFacts';
import {loadIncludedBluetoothTransportFacts} from './bluetoothFacts';
import {
    loadIncludedAssignmentGrantFacts,
    loadIncludedCostCenterFacts,
    loadIncludedEnergyClassificationFacts,
    loadIncludedVisualAssetFacts
} from './centerScopedFacts';
import {
    loadIncludedComponentFacts,
    loadIncludedControlFacts,
    loadIncludedEntityFacts
} from './componentFacts';
import {loadDerivedRelationshipSummaries} from './derivedSummaries';
import {relatedConnectorExternalIds} from './deviceLoadingCore';
import {
    loadDeviceSideSummaries,
    loadDeviceSubresourceFacts,
    loadExternalConnectionFacts,
    loadLiveDeviceSidePartialSummaries
} from './deviceSideRelationships';
import {loadIncludedHistoryEventFacts} from './historyEventFacts';
import {
    loadCenterDevice,
    loadDeviceKindMetadata,
    loadRelatedDevices
} from './includedRelatedDevices';
import {loadIncludedMembershipGraphFacts} from './membershipFacts';
import {loadNodeRedRelationshipFacts} from './nodeRedRelationships';
import {loadIncludedNotificationRoutingFacts} from './notificationRoutingFacts';
import {loadIncludedConnectorPointFacts as loadIncludedConnectorPointFactsFromRepository} from './relationshipConnectorRepository';
import {loadIncludedDashboardItemFacts} from './relationshipDashboardRepository';
import {
    loadIncludedOperationJobFacts,
    loadIncludedOperationUnitFacts
} from './relationshipOperationRepository';
import {
    loadIncludedCertificateFacts,
    loadIncludedCredentialStateFacts
} from './relationshipSecurityRepository';
import {requireOrganization} from './relationshipShared';
import type {RelationshipLoadInput} from './relationshipTypes';
import {loadIncludedServesFacts} from './servesFacts';
import type {RelationshipDeviceFact, RelationshipGraphFacts} from './types';
import {
    loadIncludedExtractionOriginFacts,
    loadIncludedProfileReferenceFacts,
    loadIncludedVirtualBindingFacts,
    loadIncludedVirtualRoleFacts
} from './virtualBindingFacts';

export async function loadRelationshipFacts(
    input: RelationshipLoadInput
): Promise<RelationshipGraphFacts | null> {
    const context = relationshipLoadContext(input);
    const center = await loadCenterDevice(context);
    if (!center) return null;
    const related = await loadRelatedDevices(context);
    const devices = await loadDeviceKindMetadata(
        context,
        mergeDeviceFacts([center, ...related])
    );
    const notificationFacts =
        await loadIncludedNotificationRoutingFacts(context);
    const membershipFacts = await loadIncludedMembershipGraphFacts(context);
    const automationFacts = await loadNodeRedRelationshipFacts({
        centerExternalId: context.centerExternalId,
        includes: context.includes,
        canReadAutomations: context.permissions.actionsRead
    });
    return {
        centerExternalId: context.centerExternalId,
        devices,
        components: loadIncludedComponentFacts(context, devices),
        entities: loadIncludedEntityFacts(context, devices),
        memberships: membershipFacts.memberships,
        membershipHierarchies: membershipFacts.hierarchies,
        visualAssets: await loadIncludedVisualAssetFacts(context),
        costCenters: await loadIncludedCostCenterFacts(context),
        servesLinks: await loadIncludedServesFacts(context),
        profileReferences: await loadIncludedProfileReferenceFacts(context),
        extractionOrigins: await loadIncludedExtractionOriginFacts(context),
        virtualRoles: await loadIncludedVirtualRoleFacts(context),
        virtualBindings: await loadIncludedVirtualBindingFacts(context),
        bluetoothTransports: await loadIncludedBluetoothTransportFacts(context),
        alertRules: await loadIncludedAlertRuleFacts(context),
        alertDestinations: notificationFacts.alertDestinations,
        maintenanceWindows: notificationFacts.maintenanceWindows,
        routingPolicies: notificationFacts.routingPolicies,
        destinationGroups: notificationFacts.destinationGroups,
        notificationChannels: notificationFacts.notificationChannels,
        onCallSchedules: notificationFacts.onCallSchedules,
        dashboardItems: await loadIncludedDashboardItemFacts(context),
        automationFlows: automationFacts.flows,
        automationNodes: automationFacts.nodes,
        energyClassifications:
            await loadIncludedEnergyClassificationFacts(context),
        operationJobs: await loadIncludedOperationJobFacts(context),
        operationUnits: await loadIncludedOperationUnitFacts(context),
        controls: await loadIncludedControlFacts(context),
        credentialStates: await loadIncludedCredentialStateFacts(context),
        certificates: await loadIncludedCertificateFacts(context),
        assignmentGrants: await loadIncludedAssignmentGrantFacts(context),
        connectorPoints: await loadIncludedConnectorPointFactsFromRepository({
            relationship: context,
            relatedExternalIds: () =>
                relatedConnectorExternalIds(requireOrganization(context))
        }),
        deviceSubresources: await loadDeviceSubresourceFacts(context),
        externalConnections: await loadExternalConnectionFacts(context),
        historyEvents: await loadIncludedHistoryEventFacts(context),
        summaries: [
            ...notificationFacts.summaries,
            ...(await loadDerivedRelationshipSummaries(context)),
            ...loadLiveDeviceSidePartialSummaries(context),
            ...loadDeviceSideSummaries(context)
        ]
    };
}

function relationshipLoadContext(
    input: RelationshipLoadInput
): RelationshipLoadInput {
    return {...input, cache: {}};
}

function mergeDeviceFacts(
    facts: readonly RelationshipDeviceFact[]
): RelationshipDeviceFact[] {
    const byId = new Map<string, RelationshipDeviceFact>();
    for (const fact of facts) byId.set(fact.externalId, fact);
    return [...byId.values()];
}
