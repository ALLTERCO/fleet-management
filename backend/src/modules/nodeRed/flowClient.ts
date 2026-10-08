// Graph writes use Node-RED revision checks to reject concurrent editor changes.
// Recipe creation and update retain the single-flow API contract.

import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {NODE_RED_SERVER_IDENTITY, nodeRedUserHeader} from './editorUserToken';
import {
    type NodeRedNodeDefinitions,
    parseNodeRedNodeDefinitions
} from './nodeDefinitions';
import {nodeRedLockedOrg} from './orgLock';

/** A raw Node-RED record: a tab, or a node inside one. */
export type FlowRecord = Record<string, unknown>;

export interface FlowsPayload {
    rev: string;
    flows: FlowRecord[];
}

export interface NodeRedNodeSet {
    id?: string;
    name?: string;
    module?: string;
    version?: string;
    enabled: boolean;
    types: string[];
}

/** One flow, in the shape the single-flow endpoints use. */
export interface FlowObject {
    id?: string;
    label: string;
    disabled?: boolean;
    nodes: FlowRecord[];
    configs?: FlowRecord[];
}

export class NodeRedRequestError extends Error {
    constructor(readonly status: number) {
        super(`Node-RED returned ${status}`);
        this.name = 'NodeRedRequestError';
    }
}

const FLOWS_PATH = '/flows';
const FLOW_PATH = '/flow';
const NODES_PATH = '/nodes';
const NODE_DEFINITIONS_PATH = '/fleet-manager-node-red/node-definitions';

const logger = log4js.getLogger('node-red-flows');

/** Enabled node types plus the editor definitions they were installed with. */
export interface InstalledNodeRed {
    types: Set<string>;
    // Null when the installed Fleet package cannot describe the definitions.
    definitions: NodeRedNodeDefinitions | null;
}

/**
 * Headers every server-side call to Node-RED carries: the proxy secret its
 * settings file requires and, when locked, the organization it belongs to.
 */
export function nodeRedServerHeaders(): Record<string, string> {
    const org = nodeRedLockedOrg();
    return {
        'x-fm-node-red-proxy-secret': tuning.nodeRed.proxySecret,
        ...(org ? {'x-fm-organization-id': org} : {})
    };
}

/** Admin API headers: the server headers plus Fleet Manager's own user. */
export function nodeRedAdminHeaders(): Record<string, string> {
    return {
        ...nodeRedServerHeaders(),
        ...nodeRedUserHeader(NODE_RED_SERVER_IDENTITY)
    };
}

/** Path Node-RED serves its editor and admin API under. */
export function nodeRedAdminRoot(): string {
    const {pathname} = new URL(tuning.nodeRed.proxyTarget);
    const adminRoot = pathname === '/' ? '/node-red/red' : pathname;
    return adminRoot.replace(/\/+$/, '');
}

/** True for the editor and admin API, false for flow HTTP endpoints. */
export function isNodeRedAdminPath(pathname: string): boolean {
    const adminRoot = nodeRedAdminRoot();
    return pathname === adminRoot || pathname.startsWith(`${adminRoot}/`);
}

/** Full URL of a Node-RED admin API path, e.g. `/flows`. */
export function nodeRedAdminUrl(path: string): string {
    const target = new URL(tuning.nodeRed.proxyTarget);
    target.pathname = `${nodeRedAdminRoot()}${path}`;
    return target.toString();
}

async function callNodeRed(
    path: string,
    init: {method: string; body?: string; headers?: Record<string, string>}
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        tuning.nodeRed.proxyTimeoutMs
    );
    try {
        const res = await fetch(nodeRedAdminUrl(path), {
            method: init.method,
            headers: {
                ...nodeRedAdminHeaders(),
                accept: 'application/json',
                ...(init.headers ?? {})
            },
            ...(init.body === undefined ? {} : {body: init.body}),
            signal: controller.signal
        });
        if (!res.ok) {
            throw new NodeRedRequestError(res.status);
        }
        return res;
    } finally {
        clearTimeout(timer);
    }
}

function jsonBody(value: unknown): {
    body: string;
    headers: Record<string, string>;
} {
    return {
        body: JSON.stringify(value),
        headers: {'content-type': 'application/json'}
    };
}

/** Read the revision and full flow set for an atomic graph mutation. */
export async function fetchNodeRedFlows(): Promise<FlowsPayload> {
    const res = await callNodeRed(FLOWS_PATH, {
        method: 'GET',
        headers: {'Node-RED-API-Version': 'v2'}
    });
    const payload: unknown = await res.json();
    if (
        !isRecord(payload) ||
        typeof payload.rev !== 'string' ||
        !Array.isArray(payload.flows) ||
        !payload.flows.every(isRecord)
    ) {
        throw new TypeError('Node-RED returned an invalid v2 flow response');
    }
    return {rev: payload.rev, flows: payload.flows};
}

/** Read the enabled node types from Node-RED's installed-node registry. */
export async function fetchNodeRedNodeTypes(): Promise<Set<string>> {
    const res = await callNodeRed(NODES_PATH, {method: 'GET'});
    const payload: unknown = await res.json();
    if (
        !Array.isArray(payload) ||
        !payload.every(
            (nodeSet) =>
                isRecord(nodeSet) &&
                typeof nodeSet.enabled === 'boolean' &&
                Array.isArray(nodeSet.types) &&
                nodeSet.types.every((type) => typeof type === 'string')
        )
    ) {
        throw new TypeError(
            'Node-RED returned an invalid installed-node response'
        );
    }
    return new Set(
        payload
            .filter((nodeSet) => nodeSet.enabled)
            .flatMap((nodeSet) => nodeSet.types as string[])
    );
}

/** Read the installed editor definitions described by the Fleet package. */
export async function fetchNodeRedNodeDefinitions(): Promise<NodeRedNodeDefinitions> {
    const res = await callNodeRed(NODE_DEFINITIONS_PATH, {method: 'GET'});
    return parseNodeRedNodeDefinitions(await res.json());
}

// Graph checks still run without definitions; coverage then says so.
async function definitionsOrNull(): Promise<NodeRedNodeDefinitions | null> {
    try {
        return await fetchNodeRedNodeDefinitions();
    } catch (error) {
        logger.warn('Node-RED node definitions are unavailable: %s', error);
        return null;
    }
}

/** Read enabled node types and their installed editor definitions. */
export async function fetchInstalledNodeRed(): Promise<InstalledNodeRed> {
    const [types, definitions] = await Promise.all([
        fetchNodeRedNodeTypes(),
        definitionsOrNull()
    ]);
    return {types, definitions};
}

/**
 * Atomically replaces the complete set only if `revision` is still current.
 *
 * Node-RED checks the revision inside its flow-write mutex. Callers must not
 * retry a 409 with a newer revision because that would hide a concurrent edit.
 */
export async function deployNodeRedFlows(
    revision: string,
    flows: readonly FlowRecord[]
): Promise<string> {
    const body = jsonBody({rev: revision, flows});
    const res = await callNodeRed(FLOWS_PATH, {
        method: 'POST',
        body: body.body,
        headers: {
            ...body.headers,
            'Node-RED-API-Version': 'v2',
            'Node-RED-Deployment-Type': 'flows'
        }
    });
    const payload: unknown = await res.json();
    if (!isRecord(payload) || typeof payload.rev !== 'string') {
        throw new TypeError('Node-RED returned an invalid v2 deploy response');
    }
    return payload.rev;
}

function isRecord(value: unknown): value is FlowRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Adds one automation. Node-RED assigns the id and rewrites every node's `z`
 * to match, so ids we send are suggestions, and the returned id is the truth.
 */
export async function createNodeRedFlow(flow: FlowObject): Promise<string> {
    const res = await callNodeRed(FLOW_PATH, {
        method: 'POST',
        ...jsonBody(flow)
    });
    const created = (await res.json()) as {id?: string};
    if (!created?.id) {
        throw new Error('Node-RED accepted the automation but returned no id');
    }
    return created.id;
}

/** Replaces one automation. Node-RED stops its nodes, then starts the new set. */
export async function updateNodeRedFlow(
    flowId: string,
    flow: FlowObject
): Promise<void> {
    await callNodeRed(`${FLOW_PATH}/${encodeURIComponent(flowId)}`, {
        method: 'PUT',
        ...jsonBody({...flow, id: flowId})
    });
}

export async function deleteNodeRedFlow(flowId: string): Promise<void> {
    await callNodeRed(`${FLOW_PATH}/${encodeURIComponent(flowId)}`, {
        method: 'DELETE'
    });
}
