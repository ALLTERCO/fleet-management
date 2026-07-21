import {redactMonitoringField} from '@/helpers/monitoringRedaction';
import type {TopologyEdge, TopologyNode} from '@/types/topology';

export type TopologyIncidentSeverity = 'warning' | 'critical';

export interface TopologyIncidentHint {
    id: string;
    severity: TopologyIncidentSeverity;
    message: string;
    evidence: string;
    nodeId: string | null;
    edgeId: string | null;
    route: string;
}

export interface TopologyIncidentInput {
    nodes: readonly TopologyNode[];
    edges: readonly TopologyEdge[];
    bottleneckId: string | null;
    limit?: number;
}

const DEFAULT_LIMIT = 5;

export function buildTopologyIncidentHints(
    input: TopologyIncidentInput
): TopologyIncidentHint[] {
    const hints: TopologyIncidentHint[] = [];
    addProblemNodeHints(input.nodes, hints);
    addProblemEdgeHints(input.edges, hints);
    addBottleneckHint(input, hints);
    return uniqueHints(hints).slice(0, input.limit ?? DEFAULT_LIMIT);
}

function addProblemNodeHints(
    nodes: readonly TopologyNode[],
    hints: TopologyIncidentHint[]
): void {
    for (const node of nodes) {
        if (!isProblem(node.status)) continue;
        hints.push({
            id: `node-${node.id}-${node.status}`,
            severity: node.status,
            message: messageForNode(node),
            evidence: evidenceForNode(node),
            nodeId: node.id,
            edgeId: null,
            route: routeForNode(node)
        });
    }
}

function addProblemEdgeHints(
    edges: readonly TopologyEdge[],
    hints: TopologyIncidentHint[]
): void {
    for (const edge of edges) {
        if (!isProblem(edge.status)) continue;
        hints.push({
            id: `edge-${edge.id}-${edge.status}`,
            severity: edge.status,
            message: `Connection ${edge.from} -> ${edge.to} is ${edge.status}.`,
            evidence: edge.description ?? `${edge.kind ?? 'data'} path degraded`,
            nodeId: null,
            edgeId: edge.id,
            route: routeForEdge(edge)
        });
    }
}

function addBottleneckHint(
    input: TopologyIncidentInput,
    hints: TopologyIncidentHint[]
): void {
    if (!input.bottleneckId) return;
    const node = input.nodes.find((candidate) => candidate.id === input.bottleneckId);
    if (!node) return;
    hints.push({
        id: `bottleneck-${node.id}`,
        severity: node.status === 'critical' ? 'critical' : 'warning',
        message: `${node.label} is the current likely bottleneck.`,
        evidence: bottleneckEvidence(node),
        nodeId: node.id,
        edgeId: null,
        route: routeForNode(node)
    });
}

function messageForNode(node: TopologyNode): string {
    if (node.zone === 'auth_security') {
        return 'Auth/security is degraded; permission or login changes may not propagate.';
    }
    if (node.zone === 'storage') {
        return 'Storage is degraded; writes, queues, or DB reads may be affected.';
    }
    if (node.zone === 'device_data_pipeline') {
        return 'Device data pipeline is degraded; status or event flow may lag.';
    }
    if (node.zone === 'runtime') {
        return 'Runtime is degraded; deployed process or container state needs review.';
    }
    if (node.zone === 'observability') {
        return 'Observability is degraded; monitoring data may be stale or incomplete.';
    }
    if (node.zone === 'unclassified') {
        return 'Unclassified topology module found; metadata must be fixed.';
    }
    return `${node.label} is ${node.status}.`;
}

function evidenceForNode(node: TopologyNode): string {
    const status = `status=${node.status}`;
    const zone = `zone=${node.zone ?? 'unknown'}`;
    const stats = Object.entries(node.stats ?? {})
        .slice(0, 3)
        .map(([key, value]) => `${key}=${formatEvidenceValue(key, value)}`)
        .join(', ');
    return stats ? `${status}, ${zone}, ${stats}` : `${status}, ${zone}`;
}

function bottleneckEvidence(node: TopologyNode): string {
    const keys = ['queueSize', 'pending', 'avgMs', 'latencyMs', 'errors'];
    const values = keys
        .filter((key) => node.stats?.[key] !== undefined)
        .map((key) => `${key}=${formatEvidenceValue(key, node.stats[key])}`);
    return values.length > 0 ? values.join(', ') : `zone=${node.zone ?? 'unknown'}`;
}

function formatEvidenceValue(key: string, value: unknown): string {
    const redacted = redactMonitoringField(key, value);
    if (typeof redacted === 'string') return redacted;
    if (typeof redacted === 'number' || typeof redacted === 'boolean') {
        return String(redacted);
    }
    return JSON.stringify(redacted);
}

function routeForNode(node: TopologyNode): string {
    if (node.route) return node.route;
    if (node.zone === 'storage') return '/settings/monitoring/database';
    if (node.zone === 'device_data_pipeline') return '/settings/monitoring/activity';
    if (node.zone === 'auth_security') return '/settings/monitoring/audit-log';
    if (node.zone === 'runtime') return '/settings/monitoring/runtime';
    if (node.zone === 'observability') return '/settings/monitoring/logs';
    return '/settings/monitoring/overview';
}

function routeForEdge(edge: TopologyEdge): string {
    if (edge.kind === 'storage') return '/settings/monitoring/database';
    if (edge.kind === 'auth') return '/settings/monitoring/audit-log';
    if (edge.kind === 'deploy') return '/settings/monitoring/runtime';
    return '/settings/monitoring/overview';
}

function isProblem(status: string): status is TopologyIncidentSeverity {
    return status === 'warning' || status === 'critical';
}

function uniqueHints(hints: readonly TopologyIncidentHint[]): TopologyIncidentHint[] {
    const seen = new Set<string>();
    const out: TopologyIncidentHint[] = [];
    for (const hint of hints) {
        if (seen.has(hint.id)) continue;
        seen.add(hint.id);
        out.push(hint);
    }
    return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity: TopologyIncidentSeverity): number {
    return severity === 'critical' ? 2 : 1;
}
