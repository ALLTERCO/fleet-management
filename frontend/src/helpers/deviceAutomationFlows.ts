// "Used in automations" for one device, read from its relationship graph:
// device <-> automation node (refs / event feed) <- flow (automation_calls_rpc).

import type {DeviceRelationshipsGraph} from '@/shell/template-host/relationships';

export interface DeviceAutomationFlow {
    flowId: string;
    label: string;
    enabled: boolean;
    /** True when the device's own events start the flow. */
    triggers: boolean;
}

type Edge = DeviceRelationshipsGraph['edges'][number];

const FLOW_NODE_PREFIX = 'automation_flow:';

/** Flows that read from or act on the graph's center device, by label. */
export function automationFlowsForDevice(
    graph: DeviceRelationshipsGraph
): DeviceAutomationFlow[] {
    const nodeRoles = automationNodesTouchingCenter(graph);
    const flows = new Map<string, DeviceAutomationFlow>();
    for (const edge of graph.edges) {
        if (edge.type !== 'automation_calls_rpc') continue;
        const triggers = nodeRoles.get(edge.target);
        if (triggers === undefined) continue;
        addFlow(flows, {graph, flowNodeId: edge.source, triggers});
    }
    return [...flows.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Node-RED tab id behind an `automation_flow:<id>` graph node id. */
export function flowIdOfGraphNode(nodeId: string): string | null {
    return nodeId.startsWith(FLOW_NODE_PREFIX)
        ? nodeId.slice(FLOW_NODE_PREFIX.length)
        : null;
}

// automation node id -> whether that node is fed by the device's events.
function automationNodesTouchingCenter(
    graph: DeviceRelationshipsGraph
): Map<string, boolean> {
    const roles = new Map<string, boolean>();
    for (const edge of graph.edges) {
        const nodeId = automationNodeOnCenterEdge(edge, graph.center);
        if (!nodeId) continue;
        const triggers = edge.type === 'device_event_feeds_automation';
        roles.set(nodeId, (roles.get(nodeId) ?? false) || triggers);
    }
    return roles;
}

function automationNodeOnCenterEdge(edge: Edge, center: string): string | null {
    if (edge.type === 'automation_refs_device' && edge.target === center) {
        return edge.source;
    }
    if (
        edge.type === 'device_event_feeds_automation' &&
        edge.source === center
    ) {
        return edge.target;
    }
    return null;
}

function addFlow(
    flows: Map<string, DeviceAutomationFlow>,
    input: {
        graph: DeviceRelationshipsGraph;
        flowNodeId: string;
        triggers: boolean;
    }
): void {
    const flowId = flowIdOfGraphNode(input.flowNodeId);
    if (!flowId) return;
    const existing = flows.get(flowId);
    if (existing) {
        existing.triggers ||= input.triggers;
        return;
    }
    const node = input.graph.nodes.find((n) => n.id === input.flowNodeId);
    flows.set(flowId, {
        flowId,
        label: node?.label ?? flowId,
        enabled: node?.status !== 'disabled',
        triggers: input.triggers
    });
}
