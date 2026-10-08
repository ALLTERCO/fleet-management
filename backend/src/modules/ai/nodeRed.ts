// Node-RED, made visible to an agent.
//
// Node-RED can drive Fleet Manager through 28 nodes. The reverse was not true:
// an agent could not tell whether an install even had a Node-RED.
//
// Read half only. Changing an automation goes through automation.SetEnabled and
// automation.Delete, so it gets the permission check, audit row and human
// confirmation instead of a second approval path here.

import {nodeRedAvailable} from '../nodeRed/available';
import {fetchNodeRedFlows} from '../nodeRed/flowClient';
import {type NodeRedFlow, summarizeFlowSet} from '../nodeRed/flows';

export type {NodeRedFlow};
export {fetchNodeRedFlows, nodeRedAvailable};

export interface NodeRedFlowsResult {
    flows: NodeRedFlow[];
    /** Present when there is nothing to report and the reason is not "empty". */
    note?: string;
}

type FlowsFetcher = typeof fetchNodeRedFlows;

// `available` is a parameter because tuning.nodeRed.enabled resolves once at
// load, so a test cannot flip it. Production passes nodeRedAvailable().
export async function listNodeRedFlows(
    fetchFlows: FlowsFetcher,
    available: boolean = nodeRedAvailable()
): Promise<NodeRedFlowsResult> {
    // "No flows" on an install without Node-RED reads to an operator as "your
    // automations have vanished". Say which it is.
    // "No flows" on an install without Node-RED reads as "they vanished".
    if (!available) {
        return {
            flows: [],
            note: 'Node-RED is not installed or not enabled on this Fleet Manager.'
        };
    }
    return {flows: summarizeFlowSet(await fetchFlows())};
}

/** What the automations do, not how many nodes they hold. */
export function summarizeFlows(flows: readonly NodeRedFlow[]): string {
    if (flows.length === 0) return 'There are no automations in Node-RED.';
    return flows
        .map((flow) => {
            const state = flow.disabled ? ' (switched off)' : '';
            const reach = flow.usesFleetManager
                ? ', drives Fleet Manager devices'
                : '';
            return `"${flow.label}"${state}: ${flow.nodeCount} nodes${reach}`;
        })
        .join('; ');
}
