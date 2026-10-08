import type {DeviceRelationshipInclude} from '../../types/api/device';
import {nodeRedAvailable} from '../nodeRed/available';
import {readCachedFlows} from '../nodeRed/flowCache';
import {isActingFleetManagerNode, isFlowTab} from '../nodeRed/flowCatalog';
import {
    idsFromCsv,
    nodeTargetScope,
    type ScopeResolver
} from '../nodeRed/flowDeviceIds';
import {scopeResolverFor} from '../nodeRed/flowScopeMembers';
import {nodeRedFlowMeta, nodeRedNodeMeta} from './relationshipRedaction';
import type {
    RelationshipAutomationFlowFact,
    RelationshipAutomationNodeFact
} from './types';

interface NodeRedRelationshipInput {
    organizationId: string | undefined;
    centerExternalId: string;
    includes: ReadonlySet<DeviceRelationshipInclude>;
    /** Same test as automation.List: may manage automations on this Node-RED. */
    canReadAutomations: boolean;
}

interface NodeRedFlowGraph {
    flows: RelationshipAutomationFlowFact[];
    nodes: RelationshipAutomationNodeFact[];
}

type FlowRecord = Record<string, unknown>;

export async function loadNodeRedRelationshipFacts(
    input: NodeRedRelationshipInput
): Promise<NodeRedFlowGraph> {
    if (
        !input.includes.has('automations') ||
        !input.canReadAutomations ||
        !nodeRedAvailable()
    ) {
        return emptyNodeRedGraph();
    }
    const records = await readNodeRedFlowRecords();
    const resolve = await scopeResolverFor({
        organizationId: input.organizationId,
        scopes: records.filter(isAutomationNodeRecord).map(nodeTargetScope)
    });
    return nodeRedGraphForDevice({
        records,
        centerExternalId: input.centerExternalId,
        resolve
    });
}

function emptyNodeRedGraph(): NodeRedFlowGraph {
    return {flows: [], nodes: []};
}

// Node-RED keeps flows in its own volume; its admin API is the only reader
// that sees what is actually deployed. The cache logs a failed read.
async function readNodeRedFlowRecords(): Promise<FlowRecord[]> {
    return (await readCachedFlows()).records;
}

interface DeviceGraphInput {
    records: readonly FlowRecord[];
    centerExternalId: string;
    resolve: ScopeResolver;
}

function nodeRedGraphForDevice(input: DeviceGraphInput): NodeRedFlowGraph {
    const nodes = nodeFactsForDevice(input);
    const flowIds = new Set(nodes.map((node) => node.flowId));
    return {
        flows: flowFacts(input.records).filter((flow) => flowIds.has(flow.id)),
        nodes
    };
}

function flowFacts(
    records: readonly FlowRecord[]
): RelationshipAutomationFlowFact[] {
    return records.filter(isTabRecord).map((record) => ({
        id: stringValue(record.id) ?? 'unknown-flow',
        label: stringValue(record.label, record.name) ?? 'Node-RED flow',
        disabled: booleanValue(record.disabled) ?? false,
        targetExternalIds: [],
        meta: nodeRedFlowMeta()
    }));
}

function nodeFactsForDevice(
    input: DeviceGraphInput
): RelationshipAutomationNodeFact[] {
    const tabLabels = flowLabelIndex(input.records);
    return input.records
        .filter(isAutomationNodeRecord)
        .map((record) =>
            nodeFact({
                record,
                tabLabels,
                targets: nodeTargetsSeenFromCenter({input, record})
            })
        )
        .filter((fact) =>
            fact.targetExternalIds.includes(input.centerExternalId)
        );
}

// Named devices stay as edges. Group, place, tag and fleet members add only
// the center: a fleet-wide node must not pull every device into the graph.
function nodeTargetsSeenFromCenter(args: {
    input: DeviceGraphInput;
    record: FlowRecord;
}): string[] {
    const scope = nodeTargetScope(args.record);
    const center = args.input.centerExternalId;
    const reachesCenter = args.input.resolve(scope).includes(center);
    const named = scope.deviceIds;
    return reachesCenter && !named.includes(center)
        ? [...named, center]
        : named;
}

function nodeFact(args: {
    record: FlowRecord;
    tabLabels: ReadonlyMap<string, string>;
    targets: string[];
}): RelationshipAutomationNodeFact {
    const {record, tabLabels} = args;
    const nodeKind = stringValue(record.type) ?? 'node';
    const flowId = stringValue(record.z) ?? 'unknown-flow';
    return {
        id: stringValue(record.id) ?? `${flowId}:${nodeKind}`,
        flowId,
        label: stringValue(record.name) ?? readableNodeKind(nodeKind),
        nodeKind,
        operation: nodeOperation(record),
        targetExternalIds: args.targets,
        eventNames: nodeEventNames(record),
        meta: nodeRedNodeMeta({flowLabel: tabLabels.get(flowId) ?? flowId})
    };
}

function flowLabelIndex(records: readonly FlowRecord[]): Map<string, string> {
    const labels = new Map<string, string>();
    for (const record of records.filter(isTabRecord)) {
        const id = stringValue(record.id);
        if (!id) continue;
        labels.set(id, stringValue(record.label, record.name) ?? id);
    }
    return labels;
}

function isTabRecord(record: FlowRecord): boolean {
    return isFlowTab(record);
}

function isAutomationNodeRecord(record: FlowRecord): boolean {
    return isActingFleetManagerNode(stringValue(record.type));
}

function nodeOperation(record: FlowRecord): string | undefined {
    return stringValue(record.operation);
}

function nodeEventNames(record: FlowRecord): string[] {
    return idsFromCsv(record.events);
}

function readableNodeKind(kind: string): string {
    return kind.replace(/^fm-/, 'FM ').replaceAll('-', ' ');
}

function stringValue(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}
