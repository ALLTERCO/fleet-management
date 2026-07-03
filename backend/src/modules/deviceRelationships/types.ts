import type {
    DeviceRelationshipInclude,
    RelationshipEdgeDto,
    RelationshipEdgeType,
    RelationshipNodeDto,
    RelationshipNodeId,
    RelationshipNodeType,
    RelationshipStatus,
    RelationshipSummaryDto
} from '../../types/api/device';

export const RELATIONSHIP_NODE_CAP = 250;
export const RELATIONSHIP_EDGE_CAP = 500;
export const RELATIONSHIP_SUMMARY_CAP = 50;

export interface RelationshipGraphRequest {
    centerExternalId: string;
    depth: 1 | 2;
    direction: 'both' | 'outgoing' | 'incoming';
    includes: ReadonlySet<DeviceRelationshipInclude>;
    generatedAt: string;
}

export interface DeviceRelationshipPermissions {
    alertsRead: boolean;
    accessGrantsRead: boolean;
    actionsRead: boolean;
    dashboardsRead: boolean;
    notificationsRead: boolean;
    operationsRead: DeviceRelationshipOperationPermissions;
    reportsRead: boolean;
    securityStateRead: boolean;
}

export interface DeviceRelationshipOperationPermissions {
    backupRead: boolean;
    certificateRead: boolean;
    credentialRead: boolean;
    firmwareRead: boolean;
}

export interface RelationshipReadableResources {
    groups: number[] | null;
    locations: number[] | null;
    tags: number[] | null;
}

export interface RelationshipGraphFacts {
    centerExternalId: string;
    devices: RelationshipDeviceFact[];
    components: RelationshipComponentFact[];
    entities: RelationshipEntityFact[];
    memberships: RelationshipMembershipFact[];
    membershipHierarchies: RelationshipMembershipHierarchyFact[];
    visualAssets: RelationshipVisualAssetFact[];
    costCenters: RelationshipCostCenterFact[];
    servesLinks: RelationshipServesFact[];
    profileReferences: RelationshipProfileReferenceFact[];
    extractionOrigins: RelationshipExtractionOriginFact[];
    virtualRoles: RelationshipVirtualRoleFact[];
    virtualBindings: RelationshipVirtualBindingFact[];
    bluetoothTransports: RelationshipBluetoothTransportFact[];
    alertRules: RelationshipAlertRuleFact[];
    alertDestinations: RelationshipAlertDestinationFact[];
    maintenanceWindows: RelationshipMaintenanceWindowFact[];
    routingPolicies: RelationshipRoutingPolicyFact[];
    destinationGroups: RelationshipDestinationGroupFact[];
    notificationChannels: RelationshipNotificationChannelFact[];
    onCallSchedules: RelationshipOnCallScheduleFact[];
    dashboardItems: RelationshipDashboardItemFact[];
    automationFlows: RelationshipAutomationFlowFact[];
    automationNodes: RelationshipAutomationNodeFact[];
    energyClassifications: RelationshipEnergyClassificationFact[];
    operationJobs: RelationshipOperationJobFact[];
    operationUnits: RelationshipOperationUnitFact[];
    controls: RelationshipControlFact[];
    credentialStates: RelationshipCredentialStateFact[];
    certificates: RelationshipCertificateFact[];
    assignmentGrants: RelationshipAssignmentGrantFact[];
    connectorPoints: RelationshipConnectorPointFact[];
    deviceSubresources: RelationshipDeviceSubresourceFact[];
    externalConnections: RelationshipExternalConnectionFact[];
    historyEvents: RelationshipHistoryEventFact[];
    summaries: RelationshipSummaryDto[];
}

export interface RelationshipDeviceFact {
    externalId: string;
    label: string;
    nodeType: RelationshipNodeType;
    status: RelationshipStatus;
    kind?: string;
    imageAssetId?: string | null;
    meta?: Record<string, unknown>;
}

export interface RelationshipComponentFact {
    deviceExternalId: string;
    componentKey: string;
    label: string;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipEntityFact {
    deviceExternalId: string;
    entityId: string;
    label: string;
}

export interface RelationshipMembershipFact {
    deviceExternalId: string;
    targetType: 'group' | 'location' | 'tag';
    targetId: string;
    label: string;
    imageAssetId?: string | null;
    meta?: Record<string, unknown>;
}

export interface RelationshipMembershipHierarchyFact {
    targetType: 'group' | 'location';
    childId: string;
    childLabel: string;
    parentId: string;
    parentLabel: string;
    childImageAssetId?: string | null;
    parentImageAssetId?: string | null;
    childMeta?: Record<string, unknown>;
    parentMeta?: Record<string, unknown>;
}

export interface RelationshipVisualAssetFact {
    ownerExternalId: string;
    assetId: string;
    label: string;
}

export interface RelationshipCostCenterFact {
    deviceExternalId: string;
    costCenter: string;
    label: string;
}

export interface RelationshipServesFact {
    source: RelationshipServesEndpointFact;
    target: RelationshipServesEndpointFact;
    relation: string;
    weight: number | null;
}

export interface RelationshipServesEndpointFact {
    kind: 'device' | 'group' | 'location';
    id: string;
    label: string;
    imageAssetId?: string | null;
    meta?: Record<string, unknown>;
}

export interface RelationshipProfileReferenceFact {
    virtualExternalId: string;
    profileId: string;
    label: string;
    meta?: Record<string, unknown>;
}

export interface RelationshipExtractionOriginFact {
    extractedExternalId: string;
    sourceHostExternalId: string;
    sourceHostLabel: string;
    sourceKey: string;
    sourceType: string;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipVirtualRoleFact {
    virtualExternalId: string;
    roleKey: string;
    label: string;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipVirtualBindingFact {
    virtualExternalId: string;
    roleKey: string;
    sourceExternalId: string;
    sourceComponentKey: string;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipBluetoothTransportFact {
    bluetoothExternalId: string;
    transportId: string;
    gatewayExternalId: string | null;
    gatewayComponentKey: string | null;
    label: string;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipAlertRuleFact {
    id: number;
    label: string;
    enabled: boolean;
    severity: string;
    kind: string;
    targetExternalId: string;
    targetEntityId?: string;
}

export interface RelationshipAlertDestinationFact {
    alertRuleId: number;
    destinationGroupId: number;
}

export interface RelationshipMaintenanceWindowFact {
    id: number;
    label: string;
    scopeType: 'device' | 'device_group' | 'location' | 'tag' | 'org';
    scopeIds: string[];
    startsAt: string;
    endsAt: string;
    recurrenceRule: string | null;
    reason: string | null;
    targetType?: 'device' | 'group' | 'location' | 'tag';
    targetId?: string;
}

export interface RelationshipRoutingPolicyFact {
    id: number;
    label: string;
    enabled: boolean;
    destinationGroupIds: number[];
    channelIds: number[];
    onCallScheduleIds: number[];
}

export interface RelationshipDestinationGroupFact {
    id: number;
    label: string;
    enabled: boolean;
    endpointIds: number[];
}

export interface RelationshipNotificationChannelFact {
    id: number;
    label: string;
    provider: string;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipOnCallScheduleFact {
    id: number;
    label: string;
    enabled: boolean;
    timezone: string;
}

export interface RelationshipDashboardItemFact {
    dashboardId: number;
    dashboardLabel: string;
    itemId: number;
    itemKind: 'device' | 'entity' | 'group' | 'location' | 'tag' | 'action';
    itemLabel: string;
    targetExternalId?: string;
    targetEntityId?: string;
    targetComponentKey?: string;
    targetGroupId?: number;
    targetLocationId?: number;
    targetTagId?: number;
    actionId?: number;
    actionLabel?: string;
}

export interface RelationshipAutomationFlowFact {
    id: string;
    label: string;
    disabled: boolean;
    targetExternalIds: string[];
    meta?: Record<string, unknown>;
}

export interface RelationshipAutomationNodeFact {
    id: string;
    flowId: string;
    label: string;
    nodeKind: string;
    operation?: string;
    targetExternalIds: string[];
    eventNames: string[];
    meta?: Record<string, unknown>;
}

export interface RelationshipEnergyClassificationFact {
    deviceExternalId: string;
    componentKey: string;
    tag: string;
    domain: string;
    channel: number;
}

export interface RelationshipOperationJobFact {
    id: string;
    label: string;
    kind: 'backup' | 'firmware' | 'certificate' | 'credential';
    status: RelationshipStatus;
    targetExternalId: string;
    createdAt: string;
    meta?: Record<string, unknown>;
}

export interface RelationshipOperationUnitFact {
    id: string;
    jobId: string;
    label: string;
    kind: RelationshipOperationJobFact['kind'];
    status: RelationshipStatus;
    targetExternalId: string;
    phase: string | null;
    meta?: Record<string, unknown>;
}

export interface RelationshipControlFact {
    controllerExternalId: string;
    controllerComponentKey: string;
    targetExternalId: string;
    targetComponentKey?: string;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipCredentialStateFact {
    deviceExternalId: string;
    status: RelationshipStatus;
    username: string;
    realm: string;
    rotatedAt: string | null;
}

export interface RelationshipCertificateFact {
    id: string;
    label: string;
    kind: string;
    status: RelationshipStatus;
    targetExternalId: string;
    slot: string | null;
    expiresAt: string | null;
}

export interface RelationshipAssignmentGrantFact {
    id: string;
    label: string;
    subjectType: 'user' | 'user_group';
    subjectId: string;
    personaId: string;
    targetExternalId: string;
}

export interface RelationshipConnectorPointFact {
    connectorExternalId: string;
    pointId: string;
    componentKey: string;
    label: string;
    protocol: string;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipDeviceSubresourceFact {
    id: string;
    label: string;
    family: string;
    deviceExternalId: string;
    componentKey?: string;
    componentRefs?: RelationshipDeviceSubresourceComponentRef[];
    nodeType?: RelationshipNodeType;
    hostEdgeType?: RelationshipEdgeType;
    status: RelationshipStatus;
    meta?: Record<string, unknown>;
}

export interface RelationshipDeviceSubresourceComponentRef {
    componentKey: string;
    edgeType: RelationshipEdgeType;
    meta?: Record<string, unknown>;
}

export interface RelationshipExternalConnectionFact {
    id: string;
    label: string;
    family: string;
    deviceExternalId: string;
    status: RelationshipStatus;
    componentKey?: string;
    componentRefs?: RelationshipExternalConnectionComponentRef[];
    meta?: Record<string, unknown>;
}

export interface RelationshipExternalConnectionComponentRef {
    componentKey: string;
    meta?: Record<string, unknown>;
}

export interface RelationshipHistoryEventFact {
    id: string;
    label: string;
    source: string;
    targetExternalId: string;
    targetComponentKey?: string;
    occurredAt: string;
    edgeType?: RelationshipEdgeType;
    meta?: Record<string, unknown>;
}

export interface RelationshipDraft {
    nodes: RelationshipNodeDto[];
    edges: RelationshipEdgeDto[];
    summaries: RelationshipSummaryDto[];
    // Dedup indexes — the arrays alone make addNode/addEdge O(n²).
    seenNodeIds: Set<string>;
    seenEdgeIds: Set<string>;
}

export interface RelationshipEdgeInput {
    type: RelationshipEdgeType;
    source: RelationshipNodeId;
    target: RelationshipNodeId;
    label?: string;
    status?: RelationshipStatus;
    meta?: Record<string, unknown>;
}
