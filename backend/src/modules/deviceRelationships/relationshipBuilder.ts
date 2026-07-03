import type {
    DeviceRelationshipsResponse,
    RelationshipNodeDto
} from '../../types/api/device';
import {
    addEdge,
    addNode,
    addSummary,
    componentNodeId,
    createRelationshipDraft,
    deviceNodeId,
    finalizeRelationshipGraph
} from './relationshipGraphDraft';
import {
    actionTemplateLabel,
    assignmentSubjectLabel,
    credentialStateLabel
} from './relationshipLabels';
import {credentialStateMeta} from './relationshipRedaction';
import type {
    RelationshipDraft,
    RelationshipEdgeInput,
    RelationshipGraphFacts,
    RelationshipGraphRequest
} from './types';

export {componentNodeId, deviceNodeId, edgeId} from './relationshipGraphDraft';

export function buildDeviceRelationshipGraph(input: {
    request: RelationshipGraphRequest;
    facts: RelationshipGraphFacts;
}): DeviceRelationshipsResponse {
    const draft = createRelationshipDraft();
    addDeviceFacts(draft, input.facts);
    addComponentFacts(draft, input.facts);
    addEntityFacts(draft, input.facts);
    addMembershipFacts(draft, input.facts);
    addMembershipHierarchyFacts(draft, input.facts);
    addVisualAssetFacts(draft, input.facts);
    addCostCenterFacts(draft, input.facts);
    addServesFacts(draft, input.facts);
    addProfileReferenceFacts(draft, input.facts);
    addExtractionOriginFacts(draft, input.facts);
    addVirtualBindingFacts(draft, input.facts);
    addBluetoothTransportFacts(draft, input.facts);
    addAlertRuleFacts(draft, input.facts);
    addAlertDestinationFacts(draft, input.facts);
    addNotificationRoutingFacts(draft, input.facts);
    addDashboardItemFacts(draft, input.facts);
    addAutomationFacts(draft, input.facts);
    addEnergyClassificationFacts(draft, input.facts);
    addOperationJobFacts(draft, input.facts);
    addOperationUnitFacts(draft, input.facts);
    addControlFacts(draft, input.facts);
    addSecurityStateFacts(draft, input.facts);
    addAssignmentGrantFacts(draft, input.facts);
    addConnectorPointFacts(draft, input.facts);
    addDeviceSubresourceFacts(draft, input.facts);
    addExternalConnectionFacts(draft, input.facts);
    addHistoryEventFacts(draft, input.facts);
    addFactSummaries(draft, input.facts);
    return finalizeRelationshipGraph({request: input.request, draft});
}

function addDeviceFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.devices) {
        addNode(draft, {
            id: deviceNodeId(fact.externalId),
            type: fact.nodeType,
            label: fact.label,
            externalId: fact.externalId,
            status: fact.status,
            kind: fact.kind,
            imageAssetId: fact.imageAssetId,
            meta: fact.meta
        });
    }
}

function addComponentFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.components) {
        const deviceId = deviceNodeId(fact.deviceExternalId);
        const componentId = componentNodeId(fact);
        addNode(draft, {
            id: componentId,
            type: 'component',
            label: fact.label,
            status: fact.status,
            meta: {componentKey: fact.componentKey, ...fact.meta}
        });
        addEdge(draft, {
            type: 'has_component',
            source: deviceId,
            target: componentId,
            status: fact.status
        });
    }
}

function addEntityFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.entities) {
        const deviceId = deviceNodeId(fact.deviceExternalId);
        const entityId = `entity:${fact.deviceExternalId}:${fact.entityId}`;
        addNode(draft, {
            id: entityId,
            type: 'entity',
            label: fact.label,
            meta: {entityId: fact.entityId}
        });
        addEdge(draft, {
            type: 'has_entity',
            source: deviceId,
            target: entityId
        });
    }
}

function addMembershipFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.memberships) {
        const nodeId = `${fact.targetType}:${fact.targetId}`;
        addNode(draft, {
            id: nodeId,
            type: fact.targetType,
            label: fact.label,
            imageAssetId: fact.imageAssetId,
            meta: fact.meta
        });
        addEdge(draft, {
            type: membershipEdgeType(fact.targetType),
            source: deviceNodeId(fact.deviceExternalId),
            target: nodeId
        });
    }
}

function addMembershipHierarchyFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.membershipHierarchies) {
        const childId = `${fact.targetType}:${fact.childId}`;
        const parentId = `${fact.targetType}:${fact.parentId}`;
        addNode(draft, {
            id: childId,
            type: fact.targetType,
            label: fact.childLabel,
            imageAssetId: fact.childImageAssetId,
            meta: fact.childMeta
        });
        addNode(draft, {
            id: parentId,
            type: fact.targetType,
            label: fact.parentLabel,
            imageAssetId: fact.parentImageAssetId,
            meta: fact.parentMeta
        });
        addEdge(draft, {
            type: membershipHierarchyEdgeType(fact.targetType),
            source: childId,
            target: parentId
        });
    }
}

function addVisualAssetFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.visualAssets) {
        const assetId = `asset:${fact.assetId}`;
        addNode(draft, {
            id: assetId,
            type: 'asset.visual',
            label: fact.label,
            meta: {assetId: fact.assetId}
        });
        addEdge(draft, {
            type: 'has_visual_asset',
            source: deviceNodeId(fact.ownerExternalId),
            target: assetId
        });
    }
}

function addCostCenterFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.costCenters) {
        const costCenterId = `cost_center:${encodeURIComponent(fact.costCenter)}`;
        addNode(draft, {
            id: costCenterId,
            type: 'cost.center',
            label: fact.label
        });
        addEdge(draft, {
            type: 'charged_to_cost_center',
            source: deviceNodeId(fact.deviceExternalId),
            target: costCenterId
        });
    }
}

function addServesFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.servesLinks) {
        addServesEndpointNode(draft, fact.source);
        addServesEndpointNode(draft, fact.target);
        addEdge(draft, {
            type: 'serves',
            source: servesEndpointNodeId(fact.source),
            target: servesEndpointNodeId(fact.target),
            meta: {relation: fact.relation, weight: fact.weight}
        });
    }
}

function addProfileReferenceFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.profileReferences) {
        const profileId = profileNodeId(fact.profileId);
        addNode(draft, {
            id: profileId,
            type: 'profile',
            label: fact.label,
            meta: {profileId: fact.profileId, ...fact.meta}
        });
        addEdge(draft, {
            type: 'uses_profile',
            source: deviceNodeId(fact.virtualExternalId),
            target: profileId
        });
    }
}

function addExtractionOriginFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.extractionOrigins) {
        const hostId = deviceNodeId(fact.sourceHostExternalId);
        const componentId = componentNodeId({
            deviceExternalId: fact.sourceHostExternalId,
            componentKey: fact.sourceKey
        });
        addNode(draft, {
            id: hostId,
            type: 'device.physical',
            label: fact.sourceHostLabel,
            externalId: fact.sourceHostExternalId,
            status: fact.status
        });
        addNode(draft, {
            id: componentId,
            type: 'component',
            label: fact.sourceKey,
            status: fact.status,
            meta: {
                componentKey: fact.sourceKey,
                sourceType: fact.sourceType,
                ...fact.meta
            }
        });
        addEdge(draft, {
            type: 'has_component',
            source: hostId,
            target: componentId,
            status: fact.status
        });
        addEdge(draft, {
            type: 'extracts_from',
            source: deviceNodeId(fact.extractedExternalId),
            target: componentId,
            status: fact.status
        });
    }
}

function addVirtualBindingFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.virtualRoles) addVirtualRoleNode(draft, fact);
    for (const fact of facts.virtualBindings) {
        const roleId = roleNodeId(fact.virtualExternalId, fact.roleKey);
        const sourceId = componentNodeId({
            deviceExternalId: fact.sourceExternalId,
            componentKey: fact.sourceComponentKey
        });
        addEdge(draft, {
            type: 'binds_role_to_source',
            source: roleId,
            target: sourceId,
            status: fact.status,
            meta: fact.meta
        });
        addEdge(draft, {
            type: 'source_feeds_virtual_role',
            source: sourceId,
            target: roleId,
            status: fact.status,
            meta: fact.meta
        });
        addEdge(draft, {
            type: 'used_by_virtual_device',
            source: sourceId,
            target: deviceNodeId(fact.virtualExternalId),
            status: fact.status,
            meta: fact.meta
        });
    }
}

function addBluetoothTransportFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.bluetoothTransports) {
        const transportId = `blu_transport:${fact.transportId}`;
        addNode(draft, {
            id: transportId,
            type: 'blu.transport',
            label: fact.label,
            status: fact.status,
            meta: fact.meta
        });
        addEdge(draft, {
            type: 'transported_by_gateway',
            source: deviceNodeId(fact.bluetoothExternalId),
            target: transportId,
            status: fact.status
        });
        addGatewayEdge(draft, fact);
    }
}

function addAlertRuleFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.alertRules) {
        const ruleId = `alert_rule:${fact.id}`;
        addNode(draft, {
            id: ruleId,
            type: 'alert.rule',
            label: fact.label,
            status: fact.enabled ? 'healthy' : 'disabled',
            meta: {kind: fact.kind, severity: fact.severity}
        });
        addEdge(draft, {
            type: 'watched_by_alert_rule',
            source: ruleId,
            target: alertTargetNodeId(fact),
            status: fact.enabled ? 'healthy' : 'disabled'
        });
    }
}

function addAlertDestinationFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.alertDestinations) {
        addEdge(draft, {
            type: 'routes_alert_to_destination_group',
            source: `alert_rule:${fact.alertRuleId}`,
            target: destinationGroupNodeId(fact.destinationGroupId)
        });
    }
}

function addNotificationRoutingFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    addMaintenanceWindowFacts(draft, facts);
    addDestinationGroupFacts(draft, facts);
    addNotificationChannelFacts(draft, facts);
    addOnCallScheduleFacts(draft, facts);
    addRoutingPolicyFacts(draft, facts);
}

function addMaintenanceWindowFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.maintenanceWindows) {
        const windowId = maintenanceWindowNodeId(fact.id);
        addNode(draft, {
            id: windowId,
            type: 'maintenance.window',
            label: fact.label,
            meta: {
                scopeType: fact.scopeType,
                scopeIds: fact.scopeIds,
                startsAt: fact.startsAt,
                endsAt: fact.endsAt,
                recurrenceRule: fact.recurrenceRule,
                reason: fact.reason
            }
        });
        const targetId = maintenanceWindowTargetNodeId(fact);
        if (!targetId) continue;
        addEdge(draft, {
            type: 'suppressed_by_maintenance_window',
            source: windowId,
            target: targetId
        });
    }
}

function addDestinationGroupFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.destinationGroups) {
        const groupId = destinationGroupNodeId(fact.id);
        addNode(draft, {
            id: groupId,
            type: 'notification.destination_group',
            label: fact.label,
            status: fact.enabled ? 'healthy' : 'disabled'
        });
        for (const endpointId of fact.endpointIds) {
            addEdge(draft, {
                type: 'destination_group_contains_channel',
                source: groupId,
                target: notificationChannelNodeId(endpointId)
            });
        }
    }
}

function addNotificationChannelFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.notificationChannels) {
        const channelId = notificationChannelNodeId(fact.id);
        addNode(draft, {
            id: channelId,
            type: 'notification.channel',
            label: fact.label,
            status: fact.status,
            meta: {provider: fact.provider, ...fact.meta}
        });
    }
}

function addOnCallScheduleFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.onCallSchedules) {
        addNode(draft, {
            id: onCallScheduleNodeId(fact.id),
            type: 'notification.on_call_schedule',
            label: fact.label,
            status: fact.enabled ? 'healthy' : 'disabled',
            meta: {timezone: fact.timezone}
        });
    }
}

function addRoutingPolicyFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.routingPolicies) {
        const policyId = routingPolicyNodeId(fact.id);
        addNode(draft, {
            id: policyId,
            type: 'notification.routing_policy',
            label: fact.label,
            status: fact.enabled ? 'healthy' : 'disabled'
        });
        for (const groupId of fact.destinationGroupIds) {
            addEdge(draft, {
                type: 'routes_alert_to_destination_group',
                source: policyId,
                target: destinationGroupNodeId(groupId)
            });
        }
        for (const channelId of fact.channelIds) {
            addEdge(draft, {
                type: 'routes_alert_to_channel',
                source: policyId,
                target: notificationChannelNodeId(channelId)
            });
        }
        for (const scheduleId of fact.onCallScheduleIds) {
            addEdge(draft, {
                type: 'routes_alert_to_on_call_schedule',
                source: policyId,
                target: onCallScheduleNodeId(scheduleId)
            });
        }
    }
}

function addDashboardItemFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.dashboardItems) {
        const dashboardId = `dashboard:${fact.dashboardId}`;
        const itemId = `dashboard_item:${fact.dashboardId}:${fact.itemId}`;
        addNode(draft, {
            id: dashboardId,
            type: 'dashboard',
            label: fact.dashboardLabel
        });
        addNode(draft, {
            id: itemId,
            type: 'dashboard.item',
            label: fact.itemLabel,
            meta: {kind: fact.itemKind}
        });
        addDashboardActionNode(draft, fact);
        addEdge(draft, {
            type: 'dashboard_contains_item',
            source: dashboardId,
            target: itemId
        });
        addDashboardTargetEdge(draft, {fact, itemId});
    }
}

function addAutomationFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const flow of facts.automationFlows) {
        const flowId = automationFlowNodeId(flow.id);
        addNode(draft, {
            id: flowId,
            type: 'automation.flow',
            label: flow.label,
            status: flow.disabled ? 'disabled' : 'healthy',
            meta: flow.meta
        });
    }
    for (const node of facts.automationNodes) {
        addAutomationNode(draft, node);
    }
}

function addAutomationNode(
    draft: RelationshipDraft,
    fact: RelationshipGraphFacts['automationNodes'][number]
): void {
    const nodeId = automationNodeId(fact.id);
    addNode(draft, {
        id: nodeId,
        type: 'automation.node',
        label: fact.label,
        meta: {
            nodeKind: fact.nodeKind,
            operation: fact.operation,
            eventNames: fact.eventNames,
            ...fact.meta
        }
    });
    addEdge(draft, {
        type: 'automation_calls_rpc',
        source: automationFlowNodeId(fact.flowId),
        target: nodeId,
        label: fact.operation
    });
    addAutomationTargetEdges(draft, {fact, nodeId});
}

function addAutomationTargetEdges(
    draft: RelationshipDraft,
    input: {
        fact: RelationshipGraphFacts['automationNodes'][number];
        nodeId: string;
    }
): void {
    for (const externalId of input.fact.targetExternalIds) {
        addEdge(draft, {
            type:
                input.fact.eventNames.length > 0
                    ? 'device_event_feeds_automation'
                    : 'automation_refs_device',
            source:
                input.fact.eventNames.length > 0
                    ? deviceNodeId(externalId)
                    : input.nodeId,
            target:
                input.fact.eventNames.length > 0
                    ? input.nodeId
                    : deviceNodeId(externalId)
        });
    }
}

function addEnergyClassificationFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.energyClassifications) {
        const classificationId = `energy_classification:${fact.deviceExternalId}:${fact.componentKey}`;
        addNode(draft, {
            id: classificationId,
            type: 'energy.classification',
            label: `${fact.domain}/${fact.tag}`,
            meta: {
                tag: fact.tag,
                domain: fact.domain,
                channel: fact.channel
            }
        });
        addEdge(draft, {
            type: 'classified_as_energy_role',
            source: componentNodeId(fact),
            target: classificationId
        });
    }
}

function automationFlowNodeId(flowId: string): string {
    return `automation_flow:${flowId}`;
}

function automationNodeId(nodeId: string): string {
    return `automation_node:${nodeId}`;
}

function addOperationJobFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.operationJobs) {
        addNode(draft, {
            id: operationJobNodeId(fact),
            type: 'operation.job',
            label: fact.label,
            status: fact.status,
            meta: {kind: fact.kind, createdAt: fact.createdAt, ...fact.meta}
        });
        addEdge(draft, {
            type: 'targets_device',
            source: operationJobNodeId(fact),
            target: deviceNodeId(fact.targetExternalId),
            status: fact.status
        });
    }
}

function addOperationUnitFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.operationUnits) {
        addNode(draft, {
            id: operationUnitNodeId(fact),
            type: 'operation.unit',
            label: fact.label,
            status: fact.status,
            meta: {
                kind: fact.kind,
                jobId: fact.jobId,
                phase: fact.phase,
                ...fact.meta
            }
        });
        addEdge(draft, {
            type: 'targets_device',
            source: operationUnitNodeId(fact),
            target: deviceNodeId(fact.targetExternalId),
            status: fact.status
        });
    }
}

function addControlFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.controls) {
        const source = componentNodeId({
            deviceExternalId: fact.controllerExternalId,
            componentKey: fact.controllerComponentKey
        });
        const target = controlTargetNodeId(fact);
        addEdge(draft, {
            type: 'controls',
            source,
            target,
            status: fact.status,
            meta: fact.meta
        });
        addEdge(draft, {
            type: 'controlled_by',
            source: target,
            target: source,
            status: fact.status,
            meta: fact.meta
        });
    }
}

function addSecurityStateFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    addCredentialStateFacts(draft, facts);
    addCertificateFacts(draft, facts);
}

function addCredentialStateFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.credentialStates) {
        const stateId = `credential_state:${fact.deviceExternalId}`;
        addNode(draft, {
            id: stateId,
            type: 'credential.state',
            label: credentialStateLabel(),
            status: fact.status,
            meta: credentialStateMeta({
                username: fact.username,
                realm: fact.realm,
                rotatedAt: fact.rotatedAt
            })
        });
        addEdge(draft, {
            type: 'has_credential_state',
            source: deviceNodeId(fact.deviceExternalId),
            target: stateId,
            status: fact.status
        });
    }
}

function addCertificateFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.certificates) {
        const certificateId = `certificate:${fact.id}`;
        addNode(draft, {
            id: certificateId,
            type: 'certificate',
            label: fact.label,
            status: fact.status,
            meta: {kind: fact.kind, slot: fact.slot, expiresAt: fact.expiresAt}
        });
        addEdge(draft, {
            type: 'has_certificate',
            source: deviceNodeId(fact.targetExternalId),
            target: certificateId,
            status: fact.status
        });
    }
}

function addAssignmentGrantFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.assignmentGrants) {
        const grantId = `assignment_grant:${fact.id}`;
        const subjectId = assignmentSubjectNodeId(fact);
        addNode(draft, assignmentSubjectNode(fact));
        addNode(draft, {
            id: grantId,
            type: 'assignment.grant',
            label: fact.label,
            meta: {
                subjectType: fact.subjectType,
                subjectId: fact.subjectId,
                personaId: fact.personaId
            }
        });
        addEdge(draft, {
            type: 'grant_assigned_to_subject',
            source: grantId,
            target: subjectId
        });
        addEdge(draft, {
            type: 'grants_access_to_device',
            source: grantId,
            target: deviceNodeId(fact.targetExternalId)
        });
    }
}

function addConnectorPointFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.connectorPoints) {
        const pointId = connectorPointNodeId(fact);
        const componentId = componentNodeId({
            deviceExternalId: fact.connectorExternalId,
            componentKey: fact.componentKey
        });
        addNode(draft, {
            id: pointId,
            type: 'connector.point',
            label: fact.label,
            status: fact.status,
            meta: {protocol: fact.protocol, pointId: fact.pointId, ...fact.meta}
        });
        addNode(draft, {
            id: componentId,
            type: 'component',
            label: fact.componentKey,
            status: fact.status,
            meta: {componentKey: fact.componentKey}
        });
        addEdge(draft, {
            type: 'has_connector_point',
            source: deviceNodeId(fact.connectorExternalId),
            target: pointId,
            status: fact.status
        });
        addEdge(draft, {
            type: 'connector_point_maps_to_component',
            source: pointId,
            target: componentId,
            status: fact.status
        });
    }
}

function addDeviceSubresourceFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.deviceSubresources) {
        const subresourceId = `device_subresource:${fact.deviceExternalId}:${fact.id}`;
        addNode(draft, {
            id: subresourceId,
            type: fact.nodeType ?? 'device.subresource',
            label: fact.label,
            status: fact.status,
            meta: {family: fact.family, ...fact.meta}
        });
        addEdge(draft, {
            type: fact.hostEdgeType ?? 'hosts_device_subresource',
            source: deviceNodeId(fact.deviceExternalId),
            target: subresourceId,
            status: fact.status
        });
        if (!fact.componentKey) continue;
        addEdge(draft, {
            type: 'subresource_refs_component',
            source: subresourceId,
            target: componentNodeId({
                deviceExternalId: fact.deviceExternalId,
                componentKey: fact.componentKey
            }),
            status: fact.status
        });
        addDeviceSubresourceComponentRefs(draft, {fact, subresourceId});
    }
}

function addDeviceSubresourceComponentRefs(
    draft: RelationshipDraft,
    input: {
        fact: RelationshipGraphFacts['deviceSubresources'][number];
        subresourceId: string;
    }
): void {
    for (const ref of input.fact.componentRefs ?? []) {
        addEdge(draft, {
            type: ref.edgeType,
            source: input.subresourceId,
            target: componentNodeId({
                deviceExternalId: input.fact.deviceExternalId,
                componentKey: ref.componentKey
            }),
            status: input.fact.status,
            meta: ref.meta
        });
    }
}

function addExternalConnectionFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.externalConnections) {
        const connectionId = `external_connection:${fact.deviceExternalId}:${fact.id}`;
        addNode(draft, {
            id: connectionId,
            type: 'external.connection',
            label: fact.label,
            status: fact.status,
            meta: {family: fact.family, ...fact.meta}
        });
        addEdge(draft, {
            type: 'configured_external_connection',
            source: deviceNodeId(fact.deviceExternalId),
            target: connectionId,
            status: fact.status
        });
        addExternalConnectionComponentKey(draft, {fact, connectionId});
        addExternalConnectionComponentRefs(draft, {fact, connectionId});
    }
}

function addExternalConnectionComponentKey(
    draft: RelationshipDraft,
    input: {
        fact: RelationshipGraphFacts['externalConnections'][number];
        connectionId: string;
    }
): void {
    if (!input.fact.componentKey) return;
    addExternalConnectionComponentRef(draft, {
        fact: input.fact,
        connectionId: input.connectionId,
        componentKey: input.fact.componentKey
    });
}

function addExternalConnectionComponentRefs(
    draft: RelationshipDraft,
    input: {
        fact: RelationshipGraphFacts['externalConnections'][number];
        connectionId: string;
    }
): void {
    for (const ref of input.fact.componentRefs ?? []) {
        addExternalConnectionComponentRef(draft, {
            fact: input.fact,
            connectionId: input.connectionId,
            componentKey: ref.componentKey,
            meta: ref.meta
        });
    }
}

function addExternalConnectionComponentRef(
    draft: RelationshipDraft,
    input: {
        fact: RelationshipGraphFacts['externalConnections'][number];
        connectionId: string;
        componentKey: string;
        meta?: Record<string, unknown>;
    }
): void {
    addEdge(draft, {
        type: 'external_connection_refs_component',
        source: input.connectionId,
        target: componentNodeId({
            deviceExternalId: input.fact.deviceExternalId,
            componentKey: input.componentKey
        }),
        status: input.fact.status,
        meta: input.meta
    });
}

function addHistoryEventFacts(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.historyEvents) {
        const eventId = `history_event:${fact.id}`;
        addNode(draft, {
            id: eventId,
            type: 'history.event',
            label: fact.label,
            meta: {
                source: fact.source,
                occurredAt: fact.occurredAt,
                ...fact.meta
            }
        });
        addEdge(draft, {
            type: fact.edgeType ?? 'recorded_history_event',
            source: eventId,
            target: historyTargetNodeId(fact)
        });
    }
}

function addDashboardActionNode(
    draft: RelationshipDraft,
    fact: RelationshipGraphFacts['dashboardItems'][number]
): void {
    if (!fact.actionId) return;
    addNode(draft, {
        id: `action_template:${fact.actionId}`,
        type: 'action.template',
        label: actionTemplateLabel({
            actionId: fact.actionId,
            actionLabel: fact.actionLabel
        })
    });
}

function addFactSummaries(
    draft: RelationshipDraft,
    facts: RelationshipGraphFacts
): void {
    for (const summary of facts.summaries) addSummary(draft, summary);
}

function operationJobNodeId(
    fact: RelationshipGraphFacts['operationJobs'][number]
): string {
    return `operation_job:${fact.kind}:${fact.id}`;
}

function operationUnitNodeId(
    fact: RelationshipGraphFacts['operationUnits'][number]
): string {
    return `operation_unit:${fact.kind}:${fact.jobId}:${fact.id}`;
}

function assignmentSubjectNode(
    fact: RelationshipGraphFacts['assignmentGrants'][number]
): RelationshipNodeDto {
    return {
        id: assignmentSubjectNodeId(fact),
        type: assignmentSubjectNodeType(fact.subjectType),
        label: assignmentSubjectLabel(fact),
        meta: {subjectType: fact.subjectType, subjectId: fact.subjectId}
    };
}

function assignmentSubjectNodeId(
    fact: RelationshipGraphFacts['assignmentGrants'][number]
): string {
    if (fact.subjectType === 'user_group') {
        return `user_group:${fact.subjectId}`;
    }
    return `user:${fact.subjectId}`;
}

function assignmentSubjectNodeType(
    subjectType: RelationshipGraphFacts['assignmentGrants'][number]['subjectType']
): RelationshipNodeDto['type'] {
    return subjectType === 'user_group' ? 'user.group' : 'user';
}

function connectorPointNodeId(
    fact: RelationshipGraphFacts['connectorPoints'][number]
): string {
    return `connector_point:${fact.connectorExternalId}:${encodeURIComponent(fact.pointId)}`;
}

function controlTargetNodeId(
    fact: RelationshipGraphFacts['controls'][number]
): string {
    if (!fact.targetComponentKey) return deviceNodeId(fact.targetExternalId);
    return componentNodeId({
        deviceExternalId: fact.targetExternalId,
        componentKey: fact.targetComponentKey
    });
}

function profileNodeId(profileId: string): string {
    return `profile:${profileId}`;
}

function historyTargetNodeId(
    fact: RelationshipGraphFacts['historyEvents'][number]
): string {
    if (!fact.targetComponentKey) return deviceNodeId(fact.targetExternalId);
    return componentNodeId({
        deviceExternalId: fact.targetExternalId,
        componentKey: fact.targetComponentKey
    });
}

function destinationGroupNodeId(id: number): string {
    return `notification_destination_group:${id}`;
}

function maintenanceWindowNodeId(id: number): string {
    return `maintenance_window:${id}`;
}

function notificationChannelNodeId(id: number): string {
    return `notification_channel:${id}`;
}

function onCallScheduleNodeId(id: number): string {
    return `notification_on_call_schedule:${id}`;
}

function routingPolicyNodeId(id: number): string {
    return `notification_routing_policy:${id}`;
}

function alertTargetNodeId(
    fact: RelationshipGraphFacts['alertRules'][number]
): string {
    if (fact.targetEntityId) {
        return `entity:${fact.targetExternalId}:${fact.targetEntityId}`;
    }
    return deviceNodeId(fact.targetExternalId);
}

function maintenanceWindowTargetNodeId(
    fact: RelationshipGraphFacts['maintenanceWindows'][number]
): string | null {
    if (!fact.targetType || !fact.targetId) return null;
    if (fact.targetType === 'device') return deviceNodeId(fact.targetId);
    return `${fact.targetType}:${fact.targetId}`;
}

function addDashboardTargetEdge(
    draft: RelationshipDraft,
    input: {
        fact: RelationshipGraphFacts['dashboardItems'][number];
        itemId: string;
    }
): void {
    const edge = dashboardTargetEdge(input);
    if (!edge) return;
    addEdge(draft, edge);
    addEdge(draft, {
        type: 'shown_on_dashboard',
        source: edge.target,
        target: `dashboard:${input.fact.dashboardId}`
    });
}

function dashboardTargetEdge(input: {
    fact: RelationshipGraphFacts['dashboardItems'][number];
    itemId: string;
}): RelationshipEdgeInput | null {
    const builders = {
        device: dashboardDeviceEdge,
        entity: dashboardEntityEdge,
        group: dashboardGroupEdge,
        location: dashboardLocationEdge,
        tag: dashboardTagEdge,
        action: dashboardActionEdge
    } satisfies Record<
        RelationshipGraphFacts['dashboardItems'][number]['itemKind'],
        (input: {
            fact: RelationshipGraphFacts['dashboardItems'][number];
            itemId: string;
        }) => RelationshipEdgeInput | null
    >;
    return builders[input.fact.itemKind](input);
}

function dashboardDeviceEdge(input: {
    fact: RelationshipGraphFacts['dashboardItems'][number];
    itemId: string;
}): RelationshipEdgeInput | null {
    if (!input.fact.targetExternalId) return null;
    return {
        type: 'dashboard_item_refs_device',
        source: input.itemId,
        target: deviceNodeId(input.fact.targetExternalId)
    };
}

function dashboardEntityEdge(input: {
    fact: RelationshipGraphFacts['dashboardItems'][number];
    itemId: string;
}): RelationshipEdgeInput | null {
    if (input.fact.targetExternalId && input.fact.targetComponentKey) {
        return dashboardComponentEdge({
            itemId: input.itemId,
            targetExternalId: input.fact.targetExternalId,
            targetComponentKey: input.fact.targetComponentKey
        });
    }
    if (!input.fact.targetExternalId || !input.fact.targetEntityId) return null;
    return {
        type: 'dashboard_item_refs_entity',
        source: input.itemId,
        target: `entity:${input.fact.targetExternalId}:${input.fact.targetEntityId}`
    };
}

function dashboardComponentEdge(input: {
    itemId: string;
    targetExternalId: string;
    targetComponentKey: string;
}): RelationshipEdgeInput {
    return {
        type: 'dashboard_item_refs_component',
        source: input.itemId,
        target: componentNodeId({
            deviceExternalId: input.targetExternalId,
            componentKey: input.targetComponentKey
        })
    };
}

function dashboardGroupEdge(input: {
    fact: RelationshipGraphFacts['dashboardItems'][number];
    itemId: string;
}): RelationshipEdgeInput | null {
    if (!input.fact.targetGroupId) return null;
    return {
        type: 'dashboard_item_refs_group',
        source: input.itemId,
        target: `group:${input.fact.targetGroupId}`
    };
}

function dashboardLocationEdge(input: {
    fact: RelationshipGraphFacts['dashboardItems'][number];
    itemId: string;
}): RelationshipEdgeInput | null {
    if (!input.fact.targetLocationId) return null;
    return {
        type: 'dashboard_item_refs_location',
        source: input.itemId,
        target: `location:${input.fact.targetLocationId}`
    };
}

function dashboardTagEdge(input: {
    fact: RelationshipGraphFacts['dashboardItems'][number];
    itemId: string;
}): RelationshipEdgeInput | null {
    if (!input.fact.targetTagId) return null;
    return {
        type: 'dashboard_item_refs_tag',
        source: input.itemId,
        target: `tag:${input.fact.targetTagId}`
    };
}

function dashboardActionEdge(input: {
    fact: RelationshipGraphFacts['dashboardItems'][number];
    itemId: string;
}): RelationshipEdgeInput | null {
    if (!input.fact.actionId) return null;
    return {
        type: 'dashboard_item_refs_action',
        source: input.itemId,
        target: `action_template:${input.fact.actionId}`
    };
}

function addVirtualRoleNode(
    draft: RelationshipDraft,
    fact: RelationshipGraphFacts['virtualRoles'][number]
): void {
    addNode(draft, {
        id: roleNodeId(fact.virtualExternalId, fact.roleKey),
        type: 'virtual.role',
        label: fact.label,
        status: fact.status,
        meta: {roleKey: fact.roleKey, ...fact.meta}
    });
    addEdge(draft, {
        type: 'depends_on_source',
        source: deviceNodeId(fact.virtualExternalId),
        target: roleNodeId(fact.virtualExternalId, fact.roleKey),
        status: fact.status
    });
}

function addGatewayEdge(
    draft: RelationshipDraft,
    fact: RelationshipGraphFacts['bluetoothTransports'][number]
): void {
    if (!fact.gatewayExternalId) return;
    addEdge(draft, {
        type: 'transported_by_gateway',
        source: deviceNodeId(fact.bluetoothExternalId),
        target: deviceNodeId(fact.gatewayExternalId),
        status: fact.status
    });
    if (!fact.gatewayComponentKey) return;
    addEdge(draft, {
        type: 'promoted_from_gateway_component',
        source: deviceNodeId(fact.bluetoothExternalId),
        target: componentNodeId({
            deviceExternalId: fact.gatewayExternalId,
            componentKey: fact.gatewayComponentKey
        }),
        status: fact.status
    });
}

function roleNodeId(virtualExternalId: string, roleKey: string): string {
    return `role:${virtualExternalId}:${roleKey}`;
}

function membershipEdgeType(
    type: RelationshipGraphFacts['memberships'][number]['targetType']
): RelationshipEdgeInput['type'] {
    const edgeTypes = {
        group: 'belongs_to_group',
        location: 'located_in',
        tag: 'tagged_with'
    } as const;
    return edgeTypes[type];
}

function membershipHierarchyEdgeType(
    type: RelationshipGraphFacts['membershipHierarchies'][number]['targetType']
): RelationshipEdgeInput['type'] {
    const edgeTypes = {
        group: 'child_of_group',
        location: 'child_of_location'
    } as const;
    return edgeTypes[type];
}

function addServesEndpointNode(
    draft: RelationshipDraft,
    endpoint: RelationshipGraphFacts['servesLinks'][number]['source']
): void {
    addNode(draft, {
        id: servesEndpointNodeId(endpoint),
        type: endpoint.kind === 'device' ? 'device.physical' : endpoint.kind,
        label: endpoint.label,
        externalId: endpoint.kind === 'device' ? endpoint.id : undefined,
        status: endpoint.kind === 'device' ? 'unknown' : undefined,
        imageAssetId: endpoint.imageAssetId,
        meta: endpoint.meta
    });
}

function servesEndpointNodeId(
    endpoint: RelationshipGraphFacts['servesLinks'][number]['source']
): string {
    if (endpoint.kind === 'device') return deviceNodeId(endpoint.id);
    return `${endpoint.kind}:${endpoint.id}`;
}
