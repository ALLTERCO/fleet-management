import type {
    DeviceRelationshipInclude,
    RelationshipSummaryDto
} from '../../types/api/device';
import type {
    BluetoothDeviceDto,
    VirtualDeviceDto,
    VirtualDeviceKind,
    VirtualDeviceProfileRole
} from '../../types/api/virtualdevice';
import type {RelationshipDashboardCache} from './relationshipDashboardRepository';
import type {RelationshipOperationCache} from './relationshipOperationRepository';
import type {RelationshipSecurityCache} from './relationshipSecurityRepository';
import type {
    DeviceRelationshipPermissions,
    RelationshipAlertDestinationFact,
    RelationshipDestinationGroupFact,
    RelationshipMaintenanceWindowFact,
    RelationshipMembershipFact,
    RelationshipMembershipHierarchyFact,
    RelationshipNotificationChannelFact,
    RelationshipOnCallScheduleFact,
    RelationshipReadableResources,
    RelationshipRoutingPolicyFact,
    RelationshipServesEndpointFact
} from './types';

export interface RelationshipLoadInput {
    organizationId: string | undefined;
    centerExternalId: string;
    includes: ReadonlySet<DeviceRelationshipInclude>;
    permissions: DeviceRelationshipPermissions;
    readableResources?: RelationshipReadableResources;
    filterAccessibleDevices?: (
        externalIds: readonly string[]
    ) => Promise<Set<string>>;
    cache?: RelationshipLoadCache;
}

export interface OrganizationRelationshipLoadInput
    extends RelationshipLoadInput {
    organizationId: string;
}

export interface RelationshipLoadCache
    extends RelationshipOperationCache,
        RelationshipSecurityCache,
        RelationshipDashboardCache,
        RelationshipConnectorCache {
    costCenter?: Promise<string | null>;
    bluetoothDevices?: Promise<BluetoothDeviceDto[]>;
    virtualProfileRoleFacts?: Promise<VirtualProfileRoleFact[]>;
    virtualBindingRows?: Promise<VirtualBindingRow[]>;
    virtualDevices?: Promise<VirtualDeviceDto[]>;
}

export interface DeviceMemberships {
    groupIds: number[];
    locationId: number | null;
    tagIds: number[];
}

export interface MembershipDetails {
    groups: Map<number, MembershipTargetDetails>;
    locations: Map<number, MembershipTargetDetails>;
    tags: Map<number, MembershipTargetDetails>;
}

export interface MembershipTargetDetails {
    label: string;
    imageAssetId?: string | null;
    meta?: Record<string, unknown>;
    parentId?: number | null;
}

export interface MembershipFactInput {
    deviceExternalId: string;
    targetType: RelationshipMembershipFact['targetType'];
    id: number;
    details: MembershipDetails;
}

export interface MembershipGraphFacts {
    memberships: RelationshipMembershipFact[];
    hierarchies: RelationshipMembershipHierarchyFact[];
}

export interface GroupMembershipRow {
    id: number;
    name: string;
    group_type: string;
    parent_group_id: number | null;
    visual_json: Record<string, unknown> | null;
    image_asset_id: string | null;
}

export interface LocationMembershipRow {
    id: number;
    name: string;
    kind: string;
    parent_location_id: number | null;
    floor_number: number | null;
    room_number: string | null;
    metadata: Record<string, unknown> | null;
}

export interface TagMembershipRow {
    id: number;
    key: string;
    name: string;
    color: string | null;
    icon: string | null;
}

export interface VirtualBindingRow {
    virtual_external_id: string;
    virtual_kind: VirtualDeviceKind;
    role_key: string;
    source_external_id: string;
    source_component_key: string;
    mode: string;
    value_type: string | null;
    writable: boolean | null;
    required: boolean | null;
    unit: string | null;
    role_metadata_json: Record<string, unknown> | null;
}

export interface VirtualRoleFactInput {
    row: VirtualBindingRow;
    profileRole?: VirtualProfileRoleFact;
}

export interface VirtualProfileRoleFact {
    virtualExternalId: string;
    profileId: string;
    role: VirtualDeviceProfileRole;
}

export interface AlertRuleRow {
    id: number;
    name: string;
    kind: string;
    enabled: boolean;
    severity: string;
    scope: unknown;
}

export interface EnergyClassificationRow {
    component_key: string;
    tag: string;
    domain: string;
    channel: number;
}

export interface MaintenanceWindowRow {
    id: number | string;
    scope_type: RelationshipMaintenanceWindowFact['scopeType'];
    scope_ids: unknown;
    starts_at: Date | string;
    ends_at: Date | string;
    recurrence_rule: string | null;
    reason: string | null;
}

export interface RoutingPolicyRow {
    id: number | string;
    name: string;
    enabled: boolean;
    resource_selectors: unknown;
    contact_points: unknown;
}

export interface AlertDestinationRow {
    rule_id: number;
    destination_group_id: number;
}

export interface DestinationGroupRow {
    id: number | string;
    name: string;
    enabled: boolean;
    endpoint_ids: number[] | null;
}

export interface NotificationChannelRow {
    id: number | string;
    name: string;
    provider: string;
    enabled: boolean;
    last_test_status: string | null;
    last_delivery_status: string | null;
}

export interface OnCallScheduleRow {
    id: number | string;
    name: string;
    timezone: string;
    enabled: boolean;
}

export interface ServesRelationshipRow {
    source_kind: RelationshipServesEndpointFact['kind'];
    source_id: string;
    target_kind: RelationshipServesEndpointFact['kind'];
    target_id: string;
    relation: string;
    weight: number | string | null;
}

export interface AssignmentGrantRow {
    id: string;
    subject_type: 'user' | 'user_group';
    subject_id: string;
    persona_id: string;
}

export interface BluetoothProvenanceRow {
    id: number | string;
    bluetooth_external_id: string;
    gateway_external_id: string | null;
    component_key: string;
    rssi: number | null;
    received_at: Date | string;
}

export interface BluetoothTransportRelationshipRow {
    bluetooth_external_id: string;
    id: string;
    mode: string;
    is_primary: boolean;
    can_write: boolean;
    enabled: boolean;
    shelly_device_external_id: string | null;
    assistant_device_external_id: string | null;
    host_adapter_id: string | null;
    serial_port_ref: string | null;
    last_seen_at: Date | string | null;
    last_rssi: number | null;
}

export interface ControlRelationshipRef {
    controllerExternalId: string;
    controllerComponentKey: string;
    targetExternalId: string;
    targetComponentKey?: string;
}

export interface VirtualBindingEventRow {
    id: string;
    event_type: 'create' | 'replace' | 'retire';
    role_key: string | null;
    virtual_external_id: string;
    old_source_json: unknown;
    new_source_json: unknown;
    reason: string | null;
    created_at: Date | string;
}

export interface NotificationRoutingFacts {
    alertDestinations: RelationshipAlertDestinationFact[];
    maintenanceWindows: RelationshipMaintenanceWindowFact[];
    routingPolicies: RelationshipRoutingPolicyFact[];
    destinationGroups: RelationshipDestinationGroupFact[];
    notificationChannels: RelationshipNotificationChannelFact[];
    onCallSchedules: RelationshipOnCallScheduleFact[];
    summaries: RelationshipSummaryDto[];
}

// Kept here (leaf types module) so the connector repo's value import of
// deviceLoadingCore does not form an import cycle back through types.
export interface RelationshipConnectorCache {
    connectorDeviceRows?: Promise<ConnectorDeviceRow[]>;
}

export interface ConnectorDeviceRow {
    external_id: string;
    name: string | null;
    jdoc: Record<string, unknown> | null;
    enabled: boolean;
}
