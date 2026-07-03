// Pure snapshot → diagram shaping (visibility, zone columns, health, grid).
// Cytoscape-free so it unit-tests without a canvas.

import type {
    ModuleStatus,
    TopologyEdge,
    TopologyNode,
    TopologyZone,
    TopologyZoneId
} from '@/types/topology';

export interface ZoneColumn {
    id: TopologyZoneId;
    label: string;
    order: number;
    members: TopologyNode[];
}

export interface GridGaps {
    columnGap: number;
    rowGap: number;
}

const STATUS_RANK: Record<ModuleStatus, number> = {
    unknown: 0,
    healthy: 1,
    warning: 2,
    critical: 3
};

const PRIMARY_STAT_KEYS = [
    'queueSize',
    'pending',
    'active',
    'queued',
    'total',
    'running'
];

export function isUnhealthy(status: ModuleStatus): boolean {
    return status === 'warning' || status === 'critical';
}

// Only services actually wired into the graph — isolated nodes are dropped.
export function connectedNodeIds(edges: readonly TopologyEdge[]): Set<string> {
    const ids = new Set<string>();
    for (const edge of edges) {
        ids.add(edge.from);
        ids.add(edge.to);
    }
    return ids;
}

// "Unhealthy" narrows to problem modules plus their direct neighbours.
export function visibleNodeIds(input: {
    nodes: readonly TopologyNode[];
    edges: readonly TopologyEdge[];
    unhealthyOnly: boolean;
}): Set<string> {
    const connected = connectedNodeIds(input.edges);
    if (!input.unhealthyOnly) return connected;
    const ids = new Set<string>();
    for (const node of input.nodes) {
        if (isUnhealthy(node.status) && connected.has(node.id))
            ids.add(node.id);
    }
    for (const edge of input.edges) {
        if (ids.has(edge.from) || ids.has(edge.to)) {
            ids.add(edge.from);
            ids.add(edge.to);
        }
    }
    return ids;
}

// One ordered column per zone (pipeline stage) that has a visible member, each
// column's members sorted by their own order.
export function zoneColumns(input: {
    nodes: readonly TopologyNode[];
    zones: readonly TopologyZone[];
}): ZoneColumn[] {
    const byZone = new Map<TopologyZoneId, TopologyNode[]>();
    for (const node of input.nodes) {
        const zone = node.zone ?? ('unclassified' as TopologyZoneId);
        const list = byZone.get(zone) ?? [];
        list.push(node);
        byZone.set(zone, list);
    }
    return [...byZone.entries()]
        .map(([id, members]) => {
            const info = input.zones.find((zone) => zone.id === id);
            return {
                id,
                label: info?.label ?? id,
                order: info?.order ?? 999,
                members: members
                    .slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            };
        })
        .sort((a, b) => a.order - b.order);
}

// Rolled-up zone health = the most severe member status (Kiali/Datadog).
export function zoneStatus(nodes: readonly TopologyNode[]): ModuleStatus {
    let worst: ModuleStatus = 'unknown';
    for (const node of nodes) {
        if (STATUS_RANK[node.status] > STATUS_RANK[worst]) worst = node.status;
    }
    return worst;
}

// First populated counter for the node's inline label, e.g. "queueSize 4".
export function primaryStat(stats: Record<string, unknown>): string {
    for (const key of PRIMARY_STAT_KEYS) {
        const value = stats[key];
        if (typeof value === 'number' || typeof value === 'boolean') {
            return `${key} ${value}`;
        }
    }
    return '';
}

// Deterministic grid: column x by pipeline order, members stacked and centred
// so every column shares one centre line.
export function gridPositions(
    columns: readonly ZoneColumn[],
    gaps: GridGaps
): Record<string, {x: number; y: number}> {
    const positions: Record<string, {x: number; y: number}> = {};
    columns.forEach((column, columnIndex) => {
        const x = columnIndex * gaps.columnGap;
        const count = column.members.length;
        column.members.forEach((node, rowIndex) => {
            const y = (rowIndex - (count - 1) / 2) * gaps.rowGap;
            positions[node.id] = {x, y};
        });
    });
    return positions;
}
