export type ModuleStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export type ModuleRole =
    | 'source'
    | 'transform'
    | 'sink'
    | 'service'
    | 'external';

export type ModuleClusterId =
    | 'ingest'
    | 'pipeline'
    | 'storage'
    | 'clients'
    | 'security'
    | 'services'
    | 'meta';

export type TopologyZoneId =
    | 'ingress'
    | 'device_admission'
    | 'device_data_pipeline'
    | 'command_plane'
    | 'runtime'
    | 'storage'
    | 'auth_security'
    | 'observability'
    | 'ui_clients'
    | 'operations'
    | 'integrations'
    | 'external_systems'
    | 'unclassified';

export type TopologyNodeKind =
    | 'module'
    | 'runtime'
    | 'store'
    | 'external'
    | 'client'
    | 'device'
    | 'virtual_group';

export type TopologyCriticality = 'low' | 'medium' | 'high' | 'critical';

export type TopologyEdgeKind =
    | 'data'
    | 'control'
    | 'auth'
    | 'storage'
    | 'observability'
    | 'deploy'
    | 'notification'
    | 'external_api';

export type TopologyFlowId =
    | 'new_device_added'
    | 'device_status_report'
    | 'user_sends_command'
    | 'create_group'
    | 'user_login'
    | 'permission_check'
    | 'firmware_update'
    | 'alert_triggered'
    | 'notification_sent'
    | 'deploy_update'
    | 'metrics_scrape'
    | 'audit_write';

export interface TopologyNode {
    id: string;
    label: string;
    role: ModuleRole;
    cluster: ModuleClusterId | null;
    zone: TopologyZoneId;
    kind: TopologyNodeKind;
    status: ModuleStatus;
    stats: Record<string, unknown>;
    route: string | null;
    description: string | null;
    virtual: boolean;
    noisy: boolean;
    order: number;
    owner: string | null;
    criticality: TopologyCriticality;
    stale: boolean;
    participatesIn: TopologyFlowId[];
    dataClasses: string[];
    externalSystem: string | null;
    collapseByDefault: boolean;
}

export interface TopologyEdge {
    id: string;
    from: string;
    to: string;
    direction: 'forward' | 'bidirectional';
    kind: TopologyEdgeKind;
    throughput: number;
    counterName: string | null;
    latencyMetric: string | null;
    errorMetric: string | null;
    throughputMetric: string | null;
    status: ModuleStatus;
    criticality: TopologyCriticality;
    declared: boolean;
    observed: boolean;
    stale: boolean;
    lastSeenAt: number | null;
    description: string | null;
    participatesIn: TopologyFlowId[];
}

export interface TopologyCluster {
    id: ModuleClusterId;
    label: string;
}

export interface TopologyZone {
    id: TopologyZoneId;
    label: string;
    description: string;
    order: number;
    collapseByDefault: boolean;
}

export interface TopologyFlow {
    id: TopologyFlowId;
    label: string;
    description: string;
    category: 'device' | 'user' | 'ops' | 'auth' | 'monitoring' | 'deploy';
    orderedNodeIds: string[];
    expectedEdgeIds: string[];
}

export interface ThresholdPair {
    warn: number;
    crit: number;
}

export interface TopologySnapshot {
    schemaVersion: 2;
    generatedAt: number;
    zones: TopologyZone[];
    nodes: TopologyNode[];
    edges: TopologyEdge[];
    flows: TopologyFlow[];
    clusters: TopologyCluster[];
    thresholds: Record<string, ThresholdPair>;
}
