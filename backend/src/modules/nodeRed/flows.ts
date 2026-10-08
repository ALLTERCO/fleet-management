// Automations, as a person thinks of them.
//
// Node-RED stores one flat array of every tab and every node. A person thinks
// in tabs: "the night setback" is one tab. This is the translation, and the
// only place that knows it, so every caller describes a flow the same way.
//
// Changes are pure functions from one flow set to the next, so a change can be
// computed, shown to a human, then deployed without re-deriving anything.

import {
    isActingFleetManagerNode,
    isFleetManagerNode,
    isFlowTab
} from './flowCatalog';
import type {FlowRecord, FlowsPayload} from './flowClient';
import {
    directScopeDevices,
    type NodeTargetScope,
    nodeTargetScope,
    type ScopeResolver
} from './flowDeviceIds';

/** One automation: a named tab, not its wiring. */
export interface NodeRedFlow {
    id: string;
    label: string;
    /** Switched off, so not running. */
    disabled: boolean;
    /** Nodes inside. Tells a big automation from an empty one. */
    nodeCount: number;
    /** Calls Fleet Manager, so it drives real devices. */
    usesFleetManager: boolean;
    /** Devices its Fleet Manager nodes reach, as far as the resolver expands. */
    deviceIds: string[];
}

function flowDeviceIds(input: {
    inside: readonly FlowRecord[];
    resolve: ScopeResolver;
}): string[] {
    const ids = actingNodeScopes(input.inside).flatMap(input.resolve);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

function payloadRecords(payload: FlowsPayload): FlowRecord[] {
    return Array.isArray(payload?.flows) ? payload.flows : [];
}

/** What each acting Fleet Manager node reaches, before expansion. */
export function actingNodeScopes(
    records: readonly FlowRecord[]
): NodeTargetScope[] {
    return records
        .filter((record) => isActingFleetManagerNode(record.type))
        .map(nodeTargetScope);
}

/** Tabs as automations; the resolver decides how far scopes expand. */
export function summarizeFlowSet(
    payload: FlowsPayload,
    resolve: ScopeResolver = directScopeDevices
): NodeRedFlow[] {
    const records = payloadRecords(payload);
    return records.filter(isFlowTab).map((tab) => {
        const id = String(tab.id ?? '');
        const inside = records.filter((record) => record.z === id);
        return {
            id,
            label: String(tab.label ?? id),
            disabled: tab.disabled === true,
            nodeCount: inside.length,
            usesFleetManager: inside.some((record) =>
                isFleetManagerNode(record.type)
            ),
            deviceIds: flowDeviceIds({inside, resolve})
        };
    });
}

export function findFlow(
    flows: readonly NodeRedFlow[],
    flowId: string
): NodeRedFlow | undefined {
    return flows.find((flow) => flow.id === flowId);
}

/**
 * Switches one automation on or off.
 *
 * Only the tab's own `disabled` changes. Node-RED can disable single nodes too,
 * and rewriting those would undo choices someone made inside the flow.
 */
export function withFlowEnabled(
    records: readonly FlowRecord[],
    flowId: string,
    enabled: boolean
): FlowRecord[] {
    return records.map((record) =>
        isFlowTab(record) && record.id === flowId
            ? {...record, disabled: !enabled}
            : record
    );
}

/**
 * Removes an automation and its nodes.
 *
 * The nodes go too. Orphans keep loading forever and are invisible in the
 * editor. Config nodes belong to no tab, so they stay.
 */
export function withoutFlow(
    records: readonly FlowRecord[],
    flowId: string
): FlowRecord[] {
    return records.filter(
        (record) =>
            !(isFlowTab(record) && record.id === flowId) && record.z !== flowId
    );
}

/** The sentence a human approves. Says if it can be undone. */
export function describeFlowChange(
    change: 'enable' | 'disable' | 'delete',
    flow: NodeRedFlow | undefined,
    flowId: string
): string {
    const name = flow ? `"${flow.label}"` : `automation ${flowId}`;
    const reach = flow?.usesFleetManager
        ? ' It drives Fleet Manager devices.'
        : '';
    if (change === 'disable') {
        return `Switch off the automation ${name}. It stops running until someone switches it back on.${reach}`;
    }
    if (change === 'enable') {
        return `Switch on the automation ${name}. It starts running immediately.${reach}`;
    }
    return `Delete the automation ${name}. Its wiring is gone and Fleet Manager cannot bring it back.${reach}`;
}
