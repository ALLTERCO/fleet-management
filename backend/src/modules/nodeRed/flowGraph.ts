import type {
    AutomationFlowGraph,
    AutomationGraphPageItem,
    AutomationSubflowGraph
} from '../../types/api/automation';
import type {FlowRecord} from './flowClient';
import {validateNodeConfigurations} from './nodeConfigurationValidation';
import type {NodeRedNodeDefinitions} from './nodeDefinitions';

export type NodeRedSubflowGraph = AutomationSubflowGraph;
export type NodeRedFlowGraph = AutomationFlowGraph;

export interface NodeRedGraphIssue {
    code: string;
    path: string;
    message: string;
}

export interface NodeRedGraphValidationContext {
    installedNodeTypes: ReadonlySet<string>;
    knownSubflowIds?: ReadonlySet<string>;
    knownConfigurationRecords?: readonly FlowRecord[];
    nodeDefinitions?: NodeRedNodeDefinitions | null;
}

export interface NodeRedGraphPage {
    items: AutomationGraphPageItem[];
    offset: number;
    total: number;
}

const REDACTED = '[redacted]';

export class UnresolvedGraphRedaction extends Error {
    constructor(path: string) {
        super(`redacted graph value has no stored value at ${path}`);
        this.name = 'UnresolvedGraphRedaction';
    }
}

export class ReferencedGlobalGraphRecord extends Error {
    constructor(id: string) {
        super(
            `global Node-RED record ${id} is still referenced by another flow`
        );
        this.name = 'ReferencedGlobalGraphRecord';
    }
}

function isRecord(value: unknown): value is FlowRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutKeys(record: FlowRecord, keys: readonly string[]): FlowRecord {
    return Object.fromEntries(
        Object.entries(record).filter(([key]) => !keys.includes(key))
    );
}

function isNode(record: FlowRecord): boolean {
    return (
        record.type === 'group' ||
        (Object.hasOwn(record, 'x') && Object.hasOwn(record, 'y'))
    );
}

function splitChildren(
    records: readonly FlowRecord[],
    parentId: string
): {
    nodes: FlowRecord[];
    configs: FlowRecord[];
} {
    const children = records.filter((record) => record.z === parentId);
    return {
        nodes: children.filter(isNode).map((record) => ({...record})),
        configs: children
            .filter((record) => !isNode(record))
            .map((record) => ({...record}))
    };
}

function readGlobalGraph(records: readonly FlowRecord[]): NodeRedFlowGraph {
    const subflowRecords = records.filter(
        (record) => record.type === 'subflow'
    );
    const subflows = subflowRecords.map((record) => {
        const id = String(record.id);
        const children = splitChildren(records, id);
        return {
            id,
            properties: withoutKeys(record, ['id', 'type']),
            ...children
        };
    });
    const parentIds = new Set(
        records
            .filter(
                (record) => record.type === 'tab' || record.type === 'subflow'
            )
            .map((record) => String(record.id))
    );
    return {
        properties: {},
        nodes: [],
        configs: records
            .filter(
                (record) =>
                    record.type !== 'tab' &&
                    record.type !== 'subflow' &&
                    !isNode(record) &&
                    !parentIds.has(String(record.z ?? ''))
            )
            .map((record) => ({...record})),
        subflows
    };
}

export function readFlowGraph(
    records: readonly FlowRecord[],
    flowId: string
): NodeRedFlowGraph | null {
    if (flowId === 'global') return readGlobalGraph(records);
    const tab = records.find(
        (record) => record.type === 'tab' && record.id === flowId
    );
    if (!tab) return null;
    return {
        properties: withoutKeys(tab, ['id', 'type']),
        ...splitChildren(records, flowId),
        subflows: []
    };
}

export function graphPageItems(
    graph: NodeRedFlowGraph
): AutomationGraphPageItem[] {
    return [
        {kind: 'properties', value: {...graph.properties}},
        ...graph.nodes.map((value) => ({
            kind: 'node' as const,
            value: {...value}
        })),
        ...graph.configs.map((value) => ({
            kind: 'config' as const,
            value: {...value}
        })),
        ...graph.subflows.flatMap((subflow) => [
            {
                kind: 'subflow' as const,
                subflowId: subflow.id,
                value: {...subflow.properties}
            },
            ...subflow.nodes.map((value) => ({
                kind: 'subflow_node' as const,
                subflowId: subflow.id,
                value: {...value}
            })),
            ...subflow.configs.map((value) => ({
                kind: 'subflow_config' as const,
                subflowId: subflow.id,
                value: {...value}
            }))
        ])
    ];
}

export function readFlowGraphPage(
    graph: NodeRedFlowGraph,
    offset: number,
    limit: number
): NodeRedGraphPage {
    const entries = graphPageItems(graph);
    if (offset > 0 && offset >= entries.length) {
        throw new RangeError('graph page offset exceeds graph entry count');
    }
    const items = entries.slice(offset, offset + limit);
    return {
        items,
        offset,
        total: entries.length
    };
}

function appendIssue(
    issues: NodeRedGraphIssue[],
    code: string,
    path: string,
    message: string
): void {
    issues.push({code, path, message});
}

function validateRecord(
    value: unknown,
    path: string,
    issues: NodeRedGraphIssue[],
    ids: Set<string>,
    expectedKind: 'node' | 'config',
    context?: NodeRedGraphValidationContext
): void {
    if (!isRecord(value)) {
        appendIssue(issues, 'record_type', path, 'must be an object');
        return;
    }
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const type = typeof value.type === 'string' ? value.type.trim() : '';
    if (!id) appendIssue(issues, 'id_required', `${path}.id`, 'is required');
    if (!type) {
        appendIssue(issues, 'type_required', `${path}.type`, 'is required');
    }
    if (type === 'tab' || type === 'subflow') {
        appendIssue(
            issues,
            'reserved_type',
            `${path}.type`,
            'tab and subflow records belong in graph structure, not node arrays'
        );
    }
    if (id) {
        if (ids.has(id)) {
            appendIssue(
                issues,
                'duplicate_id',
                `${path}.id`,
                `duplicate id ${id}`
            );
        }
        ids.add(id);
    }
    if (value.wires !== undefined) {
        const validWires =
            Array.isArray(value.wires) &&
            value.wires.every(
                (output) =>
                    Array.isArray(output) &&
                    output.every((target) => typeof target === 'string')
            );
        if (!validWires) {
            appendIssue(
                issues,
                'wires_type',
                `${path}.wires`,
                'must be an array of string arrays'
            );
        }
    }
    const positioned = Object.hasOwn(value, 'x') && Object.hasOwn(value, 'y');
    if (expectedKind === 'node' && value.type !== 'group' && !positioned) {
        appendIssue(
            issues,
            'node_position_required',
            path,
            'nodes require x and y positions'
        );
    }
    if (expectedKind === 'config' && positioned) {
        appendIssue(
            issues,
            'config_position_forbidden',
            path,
            'configuration nodes must not have x and y positions'
        );
    }
    if (type && context && !nodeTypeAvailable(type, context)) {
        appendIssue(
            issues,
            'node_type_unavailable',
            `${path}.type`,
            `node type ${type} is not installed and enabled`
        );
    }
}

function nodeTypeAvailable(
    type: string,
    context: NodeRedGraphValidationContext
): boolean {
    if (type === 'group') return true;
    if (context.installedNodeTypes.has(type)) return true;
    if (!type.startsWith('subflow:')) return false;
    return context.knownSubflowIds?.has(type.slice('subflow:'.length)) === true;
}

function validateSubflow(
    value: unknown,
    index: number,
    issues: NodeRedGraphIssue[],
    ids: Set<string>,
    context?: NodeRedGraphValidationContext
): void {
    const path = `graph.subflows[${index}]`;
    if (!isRecord(value)) {
        appendIssue(issues, 'record_type', path, 'must be an object');
        return;
    }
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    if (!id) appendIssue(issues, 'id_required', `${path}.id`, 'is required');
    if (id) {
        if (ids.has(id)) {
            appendIssue(
                issues,
                'duplicate_id',
                `${path}.id`,
                `duplicate id ${id}`
            );
        }
        ids.add(id);
    }
    if (!isRecord(value.properties)) {
        appendIssue(
            issues,
            'properties_type',
            `${path}.properties`,
            'must be an object'
        );
    }
    for (const field of ['nodes', 'configs'] as const) {
        const records = value[field];
        if (!Array.isArray(records)) {
            appendIssue(
                issues,
                'array_required',
                `${path}.${field}`,
                'is required'
            );
            continue;
        }
        records.forEach((record, recordIndex) => {
            validateRecord(
                record,
                `${path}.${field}[${recordIndex}]`,
                issues,
                ids,
                field === 'nodes' ? 'node' : 'config',
                context
            );
        });
    }
}

export function validateFlowGraph(
    graph: unknown,
    flowId?: string,
    validationContext?: NodeRedGraphValidationContext
): NodeRedGraphIssue[] {
    const issues: NodeRedGraphIssue[] = [];
    if (!isRecord(graph)) {
        return [
            {code: 'graph_type', path: 'graph', message: 'must be an object'}
        ];
    }
    if (!isRecord(graph.properties)) {
        appendIssue(
            issues,
            'properties_type',
            'graph.properties',
            'must be an object'
        );
    } else if (
        flowId !== 'global' &&
        (typeof graph.properties.label !== 'string' ||
            graph.properties.label.trim().length === 0)
    ) {
        appendIssue(
            issues,
            'label_required',
            'graph.properties.label',
            'is required for a normal flow'
        );
    }

    const ids = new Set<string>();
    for (const field of ['nodes', 'configs'] as const) {
        const records = graph[field];
        if (!Array.isArray(records)) {
            appendIssue(
                issues,
                'array_required',
                `graph.${field}`,
                'is required'
            );
            continue;
        }
        records.forEach((record, index) => {
            validateRecord(
                record,
                `graph.${field}[${index}]`,
                issues,
                ids,
                field === 'nodes' ? 'node' : 'config',
                validationContext
            );
        });
    }

    if (!Array.isArray(graph.subflows)) {
        appendIssue(issues, 'array_required', 'graph.subflows', 'is required');
    } else if (flowId !== 'global' && graph.subflows.length > 0) {
        appendIssue(
            issues,
            'subflows_require_global',
            'graph.subflows',
            'subflows are managed through flowId "global"'
        );
    } else {
        const proposedSubflowIds = new Set(
            graph.subflows
                .filter(isRecord)
                .map((subflow) => String(subflow.id ?? ''))
                .filter(Boolean)
        );
        const context = validationContext
            ? {
                  ...validationContext,
                  knownSubflowIds: new Set([
                      ...(validationContext.knownSubflowIds ?? []),
                      ...proposedSubflowIds
                  ])
              }
            : undefined;
        graph.subflows.forEach((subflow, index) => {
            validateSubflow(subflow, index, issues, ids, context);
        });
    }
    if (
        flowId === 'global' &&
        Array.isArray(graph.nodes) &&
        graph.nodes.length
    ) {
        appendIssue(
            issues,
            'global_nodes_forbidden',
            'graph.nodes',
            'global graphs contain configs and subflows, not normal nodes'
        );
    }
    if (
        flowId === 'global' &&
        isRecord(graph.properties) &&
        Object.keys(graph.properties).length > 0
    ) {
        appendIssue(
            issues,
            'global_properties_forbidden',
            'graph.properties',
            'global graphs do not have tab properties'
        );
    }
    if (
        Array.isArray(graph.nodes) &&
        graph.nodes.every(isRecord) &&
        Array.isArray(graph.configs) &&
        graph.configs.every(isRecord) &&
        Array.isArray(graph.subflows) &&
        graph.subflows.every(
            (subflow) =>
                isRecord(subflow) &&
                typeof subflow.id === 'string' &&
                isRecord(subflow.properties) &&
                Array.isArray(subflow.nodes) &&
                subflow.nodes.every(isRecord) &&
                Array.isArray(subflow.configs) &&
                subflow.configs.every(isRecord)
        )
    ) {
        issues.push(
            ...validateNodeConfigurations({
                graph: graph as unknown as NodeRedFlowGraph,
                externalConfigs: validationContext?.knownConfigurationRecords,
                definitions: validationContext?.nodeDefinitions
            })
        );
    }
    return issues;
}

function restoreValue(
    proposed: unknown,
    current: unknown,
    path: string
): unknown {
    if (proposed === REDACTED) {
        if (current === undefined || current === REDACTED) {
            throw new UnresolvedGraphRedaction(path);
        }
        return current;
    }
    if (Array.isArray(proposed)) {
        const currentItems = Array.isArray(current) ? current : [];
        return proposed.map((value, index) =>
            restoreValue(value, currentItems[index], `${path}[${index}]`)
        );
    }
    if (isRecord(proposed)) {
        const currentRecord = isRecord(current) ? current : {};
        return Object.fromEntries(
            Object.entries(proposed).map(([key, value]) => [
                key,
                restoreValue(value, currentRecord[key], `${path}.${key}`)
            ])
        );
    }
    return proposed;
}

function recordsById(records: readonly FlowRecord[]): Map<string, FlowRecord> {
    return new Map(records.map((record) => [String(record.id), record]));
}

function restoreRecords(
    proposed: readonly FlowRecord[],
    current: readonly FlowRecord[],
    path: string
): FlowRecord[] {
    const currentById = recordsById(current);
    return proposed.map((record, index) =>
        restoreValue(
            record,
            currentById.get(String(record.id)),
            `${path}[${index}]`
        )
    ) as FlowRecord[];
}

export function restoreRedactedGraph(
    proposed: NodeRedFlowGraph,
    current: NodeRedFlowGraph
): NodeRedFlowGraph {
    const currentSubflows = new Map(
        current.subflows.map((subflow) => [subflow.id, subflow])
    );
    return {
        properties: restoreValue(
            proposed.properties,
            current.properties,
            'graph.properties'
        ) as FlowRecord,
        nodes: restoreRecords(proposed.nodes, current.nodes, 'graph.nodes'),
        configs: restoreRecords(
            proposed.configs,
            current.configs,
            'graph.configs'
        ),
        subflows: proposed.subflows.map((subflow, index) => {
            const existing = currentSubflows.get(subflow.id);
            return {
                id: subflow.id,
                properties: restoreValue(
                    subflow.properties,
                    existing?.properties,
                    `graph.subflows[${index}].properties`
                ) as FlowRecord,
                nodes: restoreRecords(
                    subflow.nodes,
                    existing?.nodes ?? [],
                    `graph.subflows[${index}].nodes`
                ),
                configs: restoreRecords(
                    subflow.configs,
                    existing?.configs ?? [],
                    `graph.subflows[${index}].configs`
                )
            };
        })
    };
}

function flattenSubflow(subflow: NodeRedSubflowGraph): FlowRecord[] {
    const definition = {
        ...subflow.properties,
        id: subflow.id,
        type: 'subflow'
    };
    const children = [...subflow.nodes, ...subflow.configs].map((record) => ({
        ...record,
        z: subflow.id
    }));
    return [definition, ...children];
}

function flattenGraph(flowId: string, graph: NodeRedFlowGraph): FlowRecord[] {
    if (flowId === 'global') {
        const configs = graph.configs.map((record) => ({...record}));
        return [
            ...configs,
            ...graph.subflows.flatMap((subflow) => flattenSubflow(subflow))
        ];
    }
    const tab = {...graph.properties, id: flowId, type: 'tab'};
    const children = [...graph.nodes, ...graph.configs].map((record) => ({
        ...record,
        z: flowId
    }));
    return [tab, ...children];
}

function globalRecordIds(records: readonly FlowRecord[]): Set<string> {
    return new Set(
        records
            .filter((record) => record.type === 'subflow')
            .map((record) => String(record.id))
    );
}

function hasReference(value: unknown, id: string): boolean {
    if (value === id || value === `subflow:${id}`) return true;
    if (Array.isArray(value))
        return value.some((item) => hasReference(item, id));
    if (!isRecord(value)) return false;
    return Object.entries(value).some(
        ([key, item]) => key !== 'id' && key !== 'z' && hasReference(item, id)
    );
}

function assertRemovedGlobalsAreUnused(
    records: readonly FlowRecord[],
    graph: NodeRedFlowGraph
): void {
    const current = readGlobalGraph(records);
    const nextIds = new Set([
        ...graph.configs.map((record) => String(record.id)),
        ...graph.subflows.map((subflow) => subflow.id)
    ]);
    const removedIds = [
        ...current.configs.map((record) => String(record.id)),
        ...current.subflows.map((subflow) => subflow.id)
    ].filter((id) => !nextIds.has(id));
    const tabIds = new Set(
        records
            .filter((record) => record.type === 'tab')
            .map((record) => String(record.id))
    );
    const normalRecords = records.filter((record) =>
        tabIds.has(String(record.z))
    );
    for (const id of removedIds) {
        if (normalRecords.some((record) => hasReference(record, id))) {
            throw new ReferencedGlobalGraphRecord(id);
        }
    }
}

function withoutGraph(
    records: readonly FlowRecord[],
    flowId: string
): FlowRecord[] {
    if (flowId !== 'global') {
        return records.filter(
            (record) => record.id !== flowId && record.z !== flowId
        );
    }
    const subflowIds = globalRecordIds(records);
    const tabIds = new Set(
        records
            .filter((record) => record.type === 'tab')
            .map((record) => String(record.id))
    );
    return records.filter((record) => {
        if (record.type === 'subflow') return false;
        if (subflowIds.has(String(record.z))) return false;
        if (record.type === 'tab') return true;
        if (tabIds.has(String(record.z))) return true;
        return isNode(record);
    });
}

function assertUniqueFlowSetIds(records: readonly FlowRecord[]): void {
    const ids = new Set<string>();
    for (const [index, record] of records.entries()) {
        const id = typeof record.id === 'string' ? record.id : '';
        if (!id) throw new Error(`flow record ${index} has no id`);
        if (ids.has(id)) throw new Error(`duplicate Node-RED id ${id}`);
        ids.add(id);
    }
}

export function putFlowGraph(
    records: readonly FlowRecord[],
    flowId: string,
    graph: NodeRedFlowGraph
): FlowRecord[] {
    if (flowId === 'global') assertRemovedGlobalsAreUnused(records, graph);
    const next = [
        ...withoutGraph(records, flowId),
        ...flattenGraph(flowId, graph)
    ];
    assertUniqueFlowSetIds(next);
    return next;
}

export function createFlowGraph(
    records: readonly FlowRecord[],
    flowId: string,
    graph: NodeRedFlowGraph
): FlowRecord[] {
    if (readFlowGraph(records, flowId)) {
        throw new Error(`automation ${flowId} already exists`);
    }
    const next = [...records, ...flattenGraph(flowId, graph)];
    assertUniqueFlowSetIds(next);
    return next;
}

export function deleteFlowGraph(
    records: readonly FlowRecord[],
    flowId: string
): FlowRecord[] {
    if (flowId === 'global') {
        throw new Error('the global Node-RED graph cannot be deleted');
    }
    if (!readFlowGraph(records, flowId)) {
        throw new Error(`no automation with id ${flowId}`);
    }
    return withoutGraph(records, flowId);
}
