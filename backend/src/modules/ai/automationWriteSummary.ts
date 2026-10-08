// Approval text for writes that start or change an automation. A human must
// see what the flow can do before it runs: its node types, code and network
// nodes, outbound addresses, start state and the devices it reaches.

import {
    mergeTargetScopes,
    type NodeTargetScope,
    nodeTargetScope
} from '../nodeRed/flowDeviceIds';
import type {WriteSummary} from './writeSummary.js';

type Params = Record<string, unknown>;
type NodeRecord = Record<string, unknown>;

// Node types that reach past the flow itself, and what that means in words.
const RISKY_NODE_TYPES: Readonly<Record<string, string>> = {
    function: 'runs code',
    exec: 'runs code',
    'http request': 'reaches the network',
    'http in': 'reaches the network',
    'http response': 'reaches the network',
    'websocket in': 'reaches the network',
    'websocket out': 'reaches the network',
    'websocket-listener': 'reaches the network',
    'websocket-client': 'reaches the network',
    'tcp in': 'reaches the network',
    'tcp out': 'reaches the network',
    'tcp request': 'reaches the network',
    'udp in': 'reaches the network',
    'udp out': 'reaches the network',
    'mqtt in': 'reaches the network',
    'mqtt out': 'reaches the network',
    'mqtt-broker': 'reaches the network',
    'e-mail': 'reaches the network',
    file: 'reads or writes files',
    'file in': 'reads or writes files',
    watch: 'reads or writes files'
};

// Settings that hold a bare host rather than a URL.
const HOST_KEYS = ['host', 'server', 'broker', 'addr'] as const;
const URL_PATTERN = /\b(?:https?|wss?|mqtts?|tcp|udp):\/\/[^\s"'`<>)]+/gi;
const MAX_LISTED = 8;
// How deep a node's settings are searched for addresses.
const MAX_SCAN_DEPTH = 6;

export const AUTOMATION_SUMMARY_BUILDERS: Record<
    string,
    (p: Params) => WriteSummary
> = {
    'automation.graph.create': (p) =>
        graphSummary(`Create automation "${graphLabel(p)}".`, p),
    'automation.graph.update': (p) =>
        graphSummary(
            `Replace automation ${str(p.flowId)} with "${graphLabel(p)}".`,
            p
        ),
    'automation.create': (p) => ({
        title: `Create automation "${str(p.name)}".`,
        reversible: true,
        details: [
            ...recipeDetails(p),
            'It starts running as soon as it is saved.'
        ]
    }),
    'automation.update': (p) => ({
        title: `Change automation ${str(p.flowId)}.`,
        reversible: true,
        affected: `automation ${str(p.flowId)}`,
        details: recipeDetails(p)
    }),
    'automation.setenabled': (p) => ({
        title:
            p.enabled === true
                ? `Switch on automation ${str(p.flowId)}. It starts running now.`
                : `Switch off automation ${str(p.flowId)}. It stops running.`,
        reversible: true,
        affected: `automation ${str(p.flowId)}`
    }),
    'scopedautomation.create': (p) => ({
        title: `Create scoped automation "${str(p.name)}".`,
        reversible: true,
        details: [
            ...scopedDetails(p),
            'It starts running as soon as it is saved.'
        ]
    }),
    'scopedautomation.update': (p) => ({
        title: `Change scoped automation ${str(p.id)}.`,
        reversible: true,
        affected: `scoped automation ${str(p.id)}`,
        details: scopedDetails(p)
    }),
    'scopedautomation.run': (p) => ({
        title: `Run scoped automation ${str(p.id)} now.`,
        reversible: false,
        affected: `scoped automation ${str(p.id)}`
    })
};

function graphSummary(title: string, p: Params): WriteSummary {
    const graph = record(p.graph);
    const nodes = graphNodes(graph);
    const types = [...new Set(nodes.map((node) => str(node.type)))].sort();
    const details = [
        `${nodes.length} nodes. Types: ${listed(types) || 'none'}.`,
        ...riskWarning(types),
        ...addressLine(nodes),
        startLine(record(graph.properties)),
        targetLine(mergeTargetScopes(nodes.map(nodeTargetScope)))
    ];
    return {title, reversible: true, details};
}

// Nodes and config nodes of the tab and of every subflow it brings along.
function graphNodes(graph: Params): NodeRecord[] {
    const subflows = array(graph.subflows).map(record);
    return [
        ...array(graph.nodes),
        ...array(graph.configs),
        ...subflows.flatMap((sub) => [
            ...array(sub.nodes),
            ...array(sub.configs)
        ])
    ].map(record);
}

function riskWarning(types: readonly string[]): string[] {
    const byRisk = new Map<string, string[]>();
    for (const type of types) {
        const risk = RISKY_NODE_TYPES[type];
        if (!risk) continue;
        byRisk.set(risk, [...(byRisk.get(risk) ?? []), type]);
    }
    if (byRisk.size === 0) return [];
    const parts = [...byRisk].map(
        ([risk, risky]) => `${risk} (${risky.join(', ')})`
    );
    return [`Warning: this flow ${parts.join(' and ')}.`];
}

function addressLine(nodes: readonly NodeRecord[]): string[] {
    const found = new Set<string>();
    for (const node of nodes) collectAddresses(node, found, 0);
    if (found.size === 0) return [];
    return [`Addresses it contacts: ${listed([...found].sort())}.`];
}

function collectAddresses(value: unknown, found: Set<string>, depth: number) {
    if (depth > MAX_SCAN_DEPTH) return;
    if (typeof value === 'string') {
        for (const match of value.match(URL_PATTERN) ?? []) found.add(match);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectAddresses(item, found, depth + 1);
        return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as NodeRecord;
    for (const key of HOST_KEYS) {
        const host = node[key];
        if (typeof host === 'string' && host.trim() && !host.includes('://')) {
            found.add(host.trim());
        }
    }
    for (const item of Object.values(node)) {
        collectAddresses(item, found, depth + 1);
    }
}

function startLine(properties: Params): string {
    return properties.disabled === true
        ? 'It is saved switched off.'
        : 'It starts running as soon as it is saved.';
}

function targetLine(scope: NodeTargetScope): string {
    const parts = [
        ...(scope.fleet ? ['the whole fleet'] : []),
        ...(scope.deviceIds.length
            ? [`devices ${listed(scope.deviceIds)}`]
            : []),
        ...(scope.groupIds.length ? [`groups ${listed(scope.groupIds)}`] : []),
        ...(scope.locationIds.length
            ? [`places ${listed(scope.locationIds)}`]
            : []),
        ...(scope.tagKeys.length ? [`tags ${listed(scope.tagKeys)}`] : [])
    ];
    return parts.length
        ? `Targets: ${parts.join('; ')}.`
        : 'Targets: no devices named.';
}

function recipeDetails(p: Params): string[] {
    const when = record(p.when);
    const who = record(p.who);
    const what = record(p.what);
    const scope: NodeTargetScope = {
        deviceIds: array(who.deviceIds).map(String),
        groupIds: array(who.groupIds).map(Number),
        locationIds: array(who.locationIds).map(Number),
        tagKeys: array(who.tagKeys).map(String),
        fleet: who.fleet === true
    };
    return [
        ...(p.when ? [`Runs: ${recipeSchedule(when)}.`] : []),
        ...(p.who ? [targetLine(scope)] : []),
        ...(p.what ? [`Action: ${str(what.method)}.`] : [])
    ];
}

function recipeSchedule(when: Params): string {
    if (when.kind === 'cron') return `cron ${str(when.cron)}`;
    if (when.kind === 'everySeconds') return `every ${str(when.seconds)} s`;
    return `on events ${listed(array(when.events).map(String))}`;
}

function scopedDetails(p: Params): string[] {
    const schedule = record(p.schedule);
    const runs =
        schedule.kind === 'timer'
            ? `every ${str(schedule.seconds)} s`
            : `cron ${str(schedule.expression)}`;
    return [
        `Runs: ${runs}.`,
        `Targets: devices ${listed(array(p.deviceIds).map(String))}.`,
        `Action: ${str(p.method)}.`
    ];
}

function graphLabel(p: Params): string {
    const label = record(record(p.graph).properties).label;
    return typeof label === 'string' && label ? label : 'unnamed';
}

// A list, named, with an honest tail when it is long.
function listed(values: readonly (string | number)[]): string {
    const shown = values.slice(0, MAX_LISTED).map(String);
    const rest = values.length - shown.length;
    return `${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : String(value ?? '?');
}

function record(value: unknown): Params {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Params)
        : {};
}

function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}
