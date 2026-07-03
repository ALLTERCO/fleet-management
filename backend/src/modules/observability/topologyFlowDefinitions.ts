import type {TopologyFlow, TopologyFlowId} from './types';

export const TOPOLOGY_FLOW_DEFINITIONS: readonly Omit<
    TopologyFlow,
    'orderedNodeIds' | 'expectedEdgeIds'
>[] = [
    {
        id: 'new_device_added',
        label: 'New device added',
        description:
            'Device discovery, admission, registry, audit, and UI update',
        category: 'device'
    },
    {
        id: 'device_status_report',
        label: 'Device reports status',
        description: 'Device status data from ingress through storage and UI',
        category: 'device'
    },
    {
        id: 'user_sends_command',
        label: 'User sends command',
        description:
            'Browser command through auth, command runtime, and device path',
        category: 'user'
    },
    {
        id: 'create_group',
        label: 'Create group',
        description:
            'Group creation through auth, storage, events, and UI refresh',
        category: 'user'
    },
    {
        id: 'user_login',
        label: 'User login',
        description:
            'Browser login through OIDC, authn, authz, and session bootstrap',
        category: 'auth'
    },
    {
        id: 'permission_check',
        label: 'Permission check',
        description:
            'Auth context, role/resource resolution, and allow/deny decision',
        category: 'auth'
    },
    {
        id: 'firmware_update',
        label: 'Firmware update',
        description: 'Firmware scheduling, command path, feedback, and audit',
        category: 'ops'
    },
    {
        id: 'alert_triggered',
        label: 'Alert triggered',
        description: 'Status/event source through alert and notification path',
        category: 'ops'
    },
    {
        id: 'notification_sent',
        label: 'Notification sent',
        description:
            'Notification routing, delivery adapter, result, and audit',
        category: 'ops'
    },
    {
        id: 'deploy_update',
        label: 'Deploy / update',
        description:
            'Deploy manifest, runtime update, checks, and rollback metadata',
        category: 'deploy'
    },
    {
        id: 'metrics_scrape',
        label: 'Metrics scrape',
        description:
            'Metrics, topology, observability, and dashboard consumers',
        category: 'monitoring'
    },
    {
        id: 'audit_write',
        label: 'Audit write',
        description:
            'Audited action through audit queue, storage, and audit UI',
        category: 'ops'
    }
];

export const TOPOLOGY_FLOW_TERMS: Record<TopologyFlowId, readonly string[]> = {
    new_device_added: [
        'mdns',
        'device',
        'waiting',
        'registry',
        'auth',
        'audit',
        'event'
    ],
    device_status_report: [
        'device',
        'status',
        'queue',
        'db',
        'event',
        'observability'
    ],
    user_sends_command: [
        'ws',
        'command',
        'commander',
        'auth',
        'authz',
        'device'
    ],
    create_group: ['group', 'auth', 'authz', 'db', 'event', 'audit'],
    user_login: ['auth', 'authn', 'oidc', 'zitadel', 'token', 'session'],
    permission_check: ['auth', 'authz', 'permission', 'role', 'resource'],
    firmware_update: ['firmware', 'scheduler', 'command', 'device', 'status'],
    alert_triggered: ['alert', 'notification', 'event', 'status'],
    notification_sent: ['notification', 'delivery', 'webhook', 'audit'],
    deploy_update: [
        'deploy',
        'runtime',
        'manifest',
        'docker',
        'health',
        'rollback'
    ],
    metrics_scrape: ['metric', 'observability', 'topology', 'health'],
    audit_write: ['audit', 'db']
};

export function inferTopologyFlowsFromText(
    text: string,
    explicit: readonly TopologyFlowId[] = []
): TopologyFlowId[] {
    if (explicit.length > 0) return [...new Set(explicit)];
    const normalized = text.toLowerCase();
    const out = new Set<TopologyFlowId>();
    for (const flow of TOPOLOGY_FLOW_DEFINITIONS) {
        if (
            TOPOLOGY_FLOW_TERMS[flow.id].some((term) =>
                normalized.includes(term)
            )
        ) {
            out.add(flow.id);
        }
    }
    return [...out];
}
