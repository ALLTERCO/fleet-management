import fs from 'node:fs/promises';
import path from 'node:path';
import {tuning} from '../../config/tuning';
import type {DeviceRelationshipInclude} from '../../types/api/device';
import {nodeRedFlowMeta, nodeRedNodeMeta} from './relationshipRedaction';
import type {
    RelationshipAutomationFlowFact,
    RelationshipAutomationNodeFact
} from './types';

interface NodeRedRelationshipInput {
    centerExternalId: string;
    includes: ReadonlySet<DeviceRelationshipInclude>;
    canReadAutomations: boolean;
}

interface NodeRedFlowGraph {
    flows: RelationshipAutomationFlowFact[];
    nodes: RelationshipAutomationNodeFact[];
}

type FlowRecord = Record<string, unknown>;

const NODE_RED_OPERATION_PREFIX = 'fm-';
const NODE_RED_SERVER_NODE = 'fm-server';
const NODE_RED_TARGET_NODE = 'fm-target';
const NODE_RED_DEVICE_EVENT_NODE = 'fm-device-event';

export async function loadNodeRedRelationshipFacts(
    input: NodeRedRelationshipInput
): Promise<NodeRedFlowGraph> {
    if (!input.includes.has('automations') || !input.canReadAutomations) {
        return emptyNodeRedGraph();
    }
    const records = await readNodeRedFlowRecords();
    return nodeRedGraphForDevice({
        records,
        centerExternalId: input.centerExternalId
    });
}

function emptyNodeRedGraph(): NodeRedFlowGraph {
    return {flows: [], nodes: []};
}

async function readNodeRedFlowRecords(): Promise<FlowRecord[]> {
    try {
        const raw = await fs.readFile(nodeRedFlowPath(), 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.flatMap(flowRecord) : [];
    } catch {
        return [];
    }
}

function nodeRedFlowPath(): string {
    return path.join(tuning.nodeRed.userDir, tuning.nodeRed.flowFile);
}

function flowRecord(value: unknown): FlowRecord[] {
    return isRecord(value) ? [value] : [];
}

function nodeRedGraphForDevice(input: {
    records: readonly FlowRecord[];
    centerExternalId: string;
}): NodeRedFlowGraph {
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

function nodeFactsForDevice(input: {
    records: readonly FlowRecord[];
    centerExternalId: string;
}): RelationshipAutomationNodeFact[] {
    const tabLabels = flowLabelIndex(input.records);
    return input.records
        .filter(isAutomationNodeRecord)
        .map((record) => nodeFact(record, tabLabels))
        .filter((fact) =>
            fact.targetExternalIds.includes(input.centerExternalId)
        );
}

function nodeFact(
    record: FlowRecord,
    tabLabels: ReadonlyMap<string, string>
): RelationshipAutomationNodeFact {
    const nodeKind = stringValue(record.type) ?? 'node';
    const flowId = stringValue(record.z) ?? 'unknown-flow';
    return {
        id: stringValue(record.id) ?? `${flowId}:${nodeKind}`,
        flowId,
        label: stringValue(record.name) ?? readableNodeKind(nodeKind),
        nodeKind,
        operation: nodeOperation(record),
        targetExternalIds: nodeTargetExternalIds(record),
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
    return record.type === 'tab';
}

function isAutomationNodeRecord(record: FlowRecord): boolean {
    const type = stringValue(record.type);
    if (
        !type ||
        type === NODE_RED_SERVER_NODE ||
        type === NODE_RED_TARGET_NODE
    ) {
        return false;
    }
    return (
        type === NODE_RED_DEVICE_EVENT_NODE ||
        type.startsWith(NODE_RED_OPERATION_PREFIX)
    );
}

function nodeOperation(record: FlowRecord): string | undefined {
    return stringValue(record.operation);
}

function nodeTargetExternalIds(record: FlowRecord): string[] {
    return uniqueStrings([
        ...idsFromCsv(record.deviceIds),
        ...idsFromJsonObject(record.paramsJson),
        ...idsFromJsonObject(record.filterJson)
    ]);
}

function nodeEventNames(record: FlowRecord): string[] {
    return idsFromCsv(record.events);
}

function idsFromCsv(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}

function idsFromJsonObject(value: unknown): string[] {
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        return deviceIdsFromValue(JSON.parse(value));
    } catch {
        return [];
    }
}

function deviceIdsFromValue(value: unknown): string[] {
    const ids: string[] = [];
    collectDeviceIds({value, ids, depth: 0});
    return uniqueStrings(ids);
}

function collectDeviceIds(input: {
    value: unknown;
    ids: string[];
    depth: number;
}): void {
    if (input.depth > 4) return;
    if (Array.isArray(input.value)) {
        for (const item of input.value) {
            collectDeviceIds({
                value: item,
                ids: input.ids,
                depth: input.depth + 1
            });
        }
        return;
    }
    if (!isRecord(input.value)) return;
    collectRecordDeviceIds(input.value, input.ids);
    for (const value of Object.values(input.value)) {
        collectDeviceIds({value, ids: input.ids, depth: input.depth + 1});
    }
}

function collectRecordDeviceIds(record: FlowRecord, ids: string[]): void {
    for (const key of deviceIdKeys()) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) ids.push(value.trim());
        if (Array.isArray(value)) ids.push(...value.filter(isNonEmptyString));
    }
}

function deviceIdKeys(): readonly string[] {
    return [
        'shellyID',
        'shellyIDs',
        'deviceId',
        'deviceIds',
        'externalId',
        'externalIds'
    ];
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

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.filter(isNonEmptyString))].sort((a, b) =>
        a.localeCompare(b)
    );
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is FlowRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
