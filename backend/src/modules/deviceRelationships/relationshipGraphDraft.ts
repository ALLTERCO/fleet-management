import type {
    DeviceRelationshipsResponse,
    RelationshipEdgeDto,
    RelationshipNodeDto,
    RelationshipSummaryDto
} from '../../types/api/device';
import {
    RELATIONSHIP_EDGE_CAP,
    RELATIONSHIP_NODE_CAP,
    RELATIONSHIP_SUMMARY_CAP,
    type RelationshipDraft,
    type RelationshipEdgeInput,
    type RelationshipGraphRequest
} from './types';

export function createRelationshipDraft(): RelationshipDraft {
    return {
        nodes: [],
        edges: [],
        summaries: [],
        seenNodeIds: new Set(),
        seenEdgeIds: new Set()
    };
}

export function deviceNodeId(externalId: string): string {
    return `device:${externalId}`;
}

export function componentNodeId(input: {
    deviceExternalId: string;
    componentKey: string;
}): string {
    return `component:${input.deviceExternalId}:${input.componentKey}`;
}

export function edgeId(input: RelationshipEdgeInput): string {
    return `edge:${input.type}:${input.source}:${input.target}`;
}

export function addNode(
    draft: RelationshipDraft,
    node: RelationshipNodeDto
): void {
    if (draft.seenNodeIds.has(node.id)) return;
    draft.seenNodeIds.add(node.id);
    draft.nodes.push(stripUndefinedNodeFields(node));
}

export function addEdge(
    draft: RelationshipDraft,
    input: RelationshipEdgeInput
): void {
    const id = edgeId(input);
    if (draft.seenEdgeIds.has(id)) return;
    draft.seenEdgeIds.add(id);
    draft.edges.push({
        id,
        ...input,
        direction: 'outgoing'
    });
}

export function addSummary(
    draft: RelationshipDraft,
    summary: RelationshipSummaryDto
): void {
    draft.summaries.push(summary);
}

export function finalizeRelationshipGraph(input: {
    request: RelationshipGraphRequest;
    draft: RelationshipDraft;
}): DeviceRelationshipsResponse {
    const center = deviceNodeId(input.request.centerExternalId);
    const directed = applyDirectionFilter({
        draft: input.draft,
        center,
        direction: input.request.direction
    });
    const capped = applyCaps(directed);
    return {
        center,
        nodes: sortNodes(capped.nodes),
        edges: sortEdges(capped.edges),
        summaries: capped.summaries,
        generatedAt: input.request.generatedAt,
        depth: input.request.depth,
        truncated: capped.truncated
    };
}

function applyDirectionFilter(input: {
    draft: RelationshipDraft;
    center: string;
    direction: RelationshipGraphRequest['direction'];
}): RelationshipDraft {
    const markedEdges = markDirections({
        center: input.center,
        nodes: input.draft.nodes,
        edges: input.draft.edges
    });
    if (input.direction === 'both') {
        return {
            nodes: input.draft.nodes,
            edges: markedEdges,
            summaries: input.draft.summaries,
            seenNodeIds: input.draft.seenNodeIds,
            seenEdgeIds: input.draft.seenEdgeIds
        };
    }
    const edges = filterEdgesByDirection({
        edges: markedEdges,
        direction: input.direction
    });
    return {
        nodes: connectedNodes({
            center: input.center,
            nodes: input.draft.nodes,
            edges
        }),
        edges,
        summaries: input.draft.summaries,
        seenNodeIds: input.draft.seenNodeIds,
        seenEdgeIds: input.draft.seenEdgeIds
    };
}

function filterEdgesByDirection(input: {
    edges: RelationshipEdgeDto[];
    direction: RelationshipGraphRequest['direction'];
}): RelationshipEdgeDto[] {
    return input.edges.filter((edge) => edge.direction === input.direction);
}

function connectedNodes(input: {
    center: string;
    nodes: RelationshipNodeDto[];
    edges: RelationshipEdgeDto[];
}): RelationshipNodeDto[] {
    const connected = new Set([input.center]);
    for (const edge of input.edges) {
        connected.add(edge.source);
        connected.add(edge.target);
    }
    return input.nodes.filter((node) => connected.has(node.id));
}

function applyCaps(draft: RelationshipDraft): RelationshipDraft & {
    truncated: boolean;
} {
    const truncated =
        draft.nodes.length > RELATIONSHIP_NODE_CAP ||
        draft.edges.length > RELATIONSHIP_EDGE_CAP ||
        draft.summaries.length > RELATIONSHIP_SUMMARY_CAP;
    const summaries = draft.summaries.slice(0, RELATIONSHIP_SUMMARY_CAP);
    if (truncated && summaries.length < RELATIONSHIP_SUMMARY_CAP) {
        summaries.push({
            severity: 'warning',
            text: 'Relationship graph was truncated. Narrow includes or use a more specific view.',
            reasonCode: 'relationship_graph_truncated'
        });
    }
    return {
        nodes: draft.nodes.slice(0, RELATIONSHIP_NODE_CAP),
        edges: draft.edges.slice(0, RELATIONSHIP_EDGE_CAP),
        summaries,
        seenNodeIds: draft.seenNodeIds,
        seenEdgeIds: draft.seenEdgeIds,
        truncated
    };
}

function markDirections(input: {
    center: string;
    nodes: RelationshipNodeDto[];
    edges: RelationshipEdgeDto[];
}): RelationshipEdgeDto[] {
    const centerOwnedNodes = centerOwnedNodeIds({
        center: input.center,
        nodes: input.nodes
    });
    const directions = resolveEdgeDirections({
        edges: input.edges,
        centerOwnedNodes
    });
    return input.edges.map((edge) => ({
        ...edge,
        direction: directions.get(edge.id) ?? 'outgoing'
    }));
}

function centerOwnedNodeIds(input: {
    center: string;
    nodes: RelationshipNodeDto[];
}): Set<string> {
    const externalId = input.center.replace(/^device:/, '');
    return new Set(
        input.nodes
            .map((node) => node.id)
            .filter((nodeId) => nodeBelongsToCenter(nodeId, externalId))
    );
}

function nodeBelongsToCenter(nodeId: string, externalId: string): boolean {
    return (
        nodeId === `device:${externalId}` ||
        nodeId.startsWith(`component:${externalId}:`) ||
        nodeId.startsWith(`entity:${externalId}:`) ||
        nodeId.startsWith(`role:${externalId}:`) ||
        nodeId.startsWith(`device_subresource:${externalId}:`) ||
        nodeId.startsWith(`external_connection:${externalId}:`) ||
        nodeId.startsWith(`energy_classification:${externalId}:`) ||
        nodeId === `credential_state:${externalId}`
    );
}

function resolveEdgeDirections(input: {
    edges: RelationshipEdgeDto[];
    centerOwnedNodes: ReadonlySet<string>;
}): Map<string, RelationshipEdgeDto['direction']> {
    const directions = new Map<string, RelationshipEdgeDto['direction']>();
    const nodeDirections = new Map<
        string,
        Set<RelationshipEdgeDto['direction']>
    >();
    seedDirectEdgeDirections({
        edges: input.edges,
        centerOwnedNodes: input.centerOwnedNodes,
        directions,
        nodeDirections
    });
    propagateEdgeDirections({edges: input.edges, directions, nodeDirections});
    return directions;
}

function seedDirectEdgeDirections(input: {
    edges: RelationshipEdgeDto[];
    centerOwnedNodes: ReadonlySet<string>;
    directions: Map<string, RelationshipEdgeDto['direction']>;
    nodeDirections: Map<string, Set<RelationshipEdgeDto['direction']>>;
}): void {
    for (const edge of input.edges) {
        const direction = directEdgeDirection({
            edge,
            centerOwnedNodes: input.centerOwnedNodes
        });
        if (!direction) continue;
        assignEdgeDirection({
            edge,
            direction,
            directions: input.directions,
            nodeDirections: input.nodeDirections
        });
    }
}

function directEdgeDirection(input: {
    edge: RelationshipEdgeDto;
    centerOwnedNodes: ReadonlySet<string>;
}): RelationshipEdgeDto['direction'] | null {
    const sourceOwned = input.centerOwnedNodes.has(input.edge.source);
    const targetOwned = input.centerOwnedNodes.has(input.edge.target);
    if (sourceOwned) return 'outgoing';
    if (targetOwned) return 'incoming';
    return null;
}

function propagateEdgeDirections(input: {
    edges: RelationshipEdgeDto[];
    directions: Map<string, RelationshipEdgeDto['direction']>;
    nodeDirections: Map<string, Set<RelationshipEdgeDto['direction']>>;
}): void {
    let changed = true;
    while (changed) changed = propagateOnePass(input);
}

function propagateOnePass(input: {
    edges: RelationshipEdgeDto[];
    directions: Map<string, RelationshipEdgeDto['direction']>;
    nodeDirections: Map<string, Set<RelationshipEdgeDto['direction']>>;
}): boolean {
    let changed = false;
    for (const edge of input.edges) {
        if (input.directions.has(edge.id)) continue;
        const direction = propagatedEdgeDirection(edge, input.nodeDirections);
        if (!direction) continue;
        assignEdgeDirection({
            edge,
            direction,
            directions: input.directions,
            nodeDirections: input.nodeDirections
        });
        changed = true;
    }
    return changed;
}

function propagatedEdgeDirection(
    edge: RelationshipEdgeDto,
    nodeDirections: ReadonlyMap<
        string,
        ReadonlySet<RelationshipEdgeDto['direction']>
    >
): RelationshipEdgeDto['direction'] | null {
    const sourceDirection = singleNodeDirection(edge.source, nodeDirections);
    const targetDirection = singleNodeDirection(edge.target, nodeDirections);
    if (
        sourceDirection &&
        targetDirection &&
        sourceDirection !== targetDirection
    ) {
        return targetDirection;
    }
    return sourceDirection ?? targetDirection;
}

function singleNodeDirection(
    nodeId: string,
    nodeDirections: ReadonlyMap<
        string,
        ReadonlySet<RelationshipEdgeDto['direction']>
    >
): RelationshipEdgeDto['direction'] | null {
    const directions = nodeDirections.get(nodeId);
    if (!directions || directions.size !== 1) return null;
    return [...directions][0] ?? null;
}

function assignEdgeDirection(input: {
    edge: RelationshipEdgeDto;
    direction: RelationshipEdgeDto['direction'];
    directions: Map<string, RelationshipEdgeDto['direction']>;
    nodeDirections: Map<string, Set<RelationshipEdgeDto['direction']>>;
}): void {
    input.directions.set(input.edge.id, input.direction);
    addNodeDirection(input.nodeDirections, input.edge.source, input.direction);
    addNodeDirection(input.nodeDirections, input.edge.target, input.direction);
}

function addNodeDirection(
    nodeDirections: Map<string, Set<RelationshipEdgeDto['direction']>>,
    nodeId: string,
    direction: RelationshipEdgeDto['direction']
): void {
    const directions = nodeDirections.get(nodeId) ?? new Set();
    directions.add(direction);
    nodeDirections.set(nodeId, directions);
}

function sortNodes(nodes: RelationshipNodeDto[]): RelationshipNodeDto[] {
    return [...nodes].sort((a, b) => a.id.localeCompare(b.id));
}

function sortEdges(edges: RelationshipEdgeDto[]): RelationshipEdgeDto[] {
    return [...edges].sort((a, b) => a.id.localeCompare(b.id));
}

function stripUndefinedNodeFields(
    node: RelationshipNodeDto
): RelationshipNodeDto {
    return Object.fromEntries(
        Object.entries(node).filter(([, value]) => value !== undefined)
    ) as RelationshipNodeDto;
}
