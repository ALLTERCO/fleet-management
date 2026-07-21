import type {RouteTab} from '@/types/page-template';

// Monitoring in the settings sidebar: five items, one per operator
// question. Detail pages are tabs inside their cluster — not sidebar
// noise. The old launcher hubs (investigate, resources) were removed;
// their routes redirect.

export interface MonitoringCluster {
    /** Sidebar item label. */
    label: string;
    /** Sidebar item icon. */
    icon: string;
    /** Sidebar target — the cluster's first page. */
    path: string;
    /** Tab row shared by the cluster's pages. Empty = no tab row. */
    tabs: readonly RouteTab[];
}

export const MONITORING_CLUSTERS: readonly MonitoringCluster[] = [
    {
        label: 'Overview',
        icon: 'fas fa-heart-pulse',
        path: '/settings/monitoring/overview',
        tabs: []
    },
    {
        label: 'Activity',
        icon: 'fas fa-wave-square',
        path: '/settings/monitoring/activity',
        tabs: [
            {
                label: 'Live',
                path: '/settings/monitoring/activity',
                icon: 'fas fa-wave-square'
            },
            {
                label: 'Ingest',
                path: '/settings/monitoring/device-ingest',
                icon: 'fas fa-right-to-bracket'
            },
            {
                label: 'Commands',
                path: '/settings/monitoring/commands',
                icon: 'fas fa-terminal'
            },
            {
                label: 'Connections',
                path: '/settings/monitoring/connections',
                icon: 'fas fa-network-wired'
            },
            {
                label: 'Events',
                path: '/settings/monitoring/events',
                icon: 'fas fa-bars-staggered'
            }
        ]
    },
    {
        label: 'Logs & audit',
        icon: 'fas fa-file-lines',
        path: '/settings/monitoring/logs',
        tabs: [
            {
                label: 'Logs',
                path: '/settings/monitoring/logs',
                icon: 'fas fa-file-lines'
            },
            {
                label: 'Audit log',
                path: '/settings/monitoring/audit-log',
                icon: 'fas fa-clipboard-list'
            }
        ]
    },
    {
        label: 'System',
        icon: 'fas fa-microchip',
        path: '/settings/monitoring/runtime',
        tabs: [
            {
                label: 'Runtime',
                path: '/settings/monitoring/runtime',
                icon: 'fas fa-code-branch'
            },
            {
                label: 'Host',
                path: '/settings/monitoring/host',
                icon: 'fas fa-server'
            },
            {
                label: 'Database',
                path: '/settings/monitoring/database',
                icon: 'fas fa-database'
            },
            {
                label: 'Services',
                path: '/settings/monitoring/services',
                icon: 'fas fa-gears'
            }
        ]
    },
    {
        label: 'Tools',
        icon: 'fas fa-screwdriver-wrench',
        path: '/settings/monitoring/control-panel',
        tabs: [
            {
                label: 'Control panel',
                path: '/settings/monitoring/control-panel',
                icon: 'fas fa-sliders'
            },
            {
                label: 'Troubleshoot',
                path: '/settings/monitoring/troubleshoot',
                icon: 'fas fa-screwdriver-wrench'
            }
        ]
    }
];

/** Cluster owning a route — by root path or tab. */
export function monitoringClusterForPath(
    path: string
): MonitoringCluster | undefined {
    return MONITORING_CLUSTERS.find(
        (cluster) =>
            cluster.path === path ||
            cluster.tabs.some((tab) => tab.path === path)
    );
}

/** Tab row for a monitoring page — empty for off-cluster pages. */
export function monitoringTabsForPath(path: string): RouteTab[] {
    const cluster = MONITORING_CLUSTERS.find(
        (c) => c.path === path || c.tabs.some((tab) => tab.path === path)
    );
    return cluster ? [...cluster.tabs] : [];
}
