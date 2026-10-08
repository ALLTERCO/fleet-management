// What the generated Node-RED catalog knows: which node types are ours, and
// which node runs which method. Built from the node package itself.
//
// A name prefix test was wrong both ways: it counted third-party `fm-*` nodes
// as ours and missed renamed ones.

import * as fs from 'node:fs';
import * as path from 'node:path';
import log4js from 'log4js';

const logger = log4js.getLogger('node-red-catalog');

// Four levels up from src/modules/nodeRed and dist/modules/nodeRed.
const CATALOG_PATH = path.resolve(
    __dirname,
    '../../../..',
    'docs/generated/node-red-catalog.json'
);

// Config holders and outside-call entry points; they act on no device.
// fm-target counts: it names the devices the next node acts on.
const NON_ACTING_NODE_TYPES: ReadonlySet<string> = new Set([
    'fm-server',
    'fm-webhook-in'
]);

// Every method lists fm-rpc plus, usually, a specific node. fm-rpc is the raw
// fallback; the specific one is what a person would have dragged in.
const GENERIC_NODE_TYPE = 'fm-rpc';

interface CatalogShape {
    nodes?: {key?: string}[];
    methods?: {fullMethod?: string; nodeKeys?: string[]}[];
}

let cached: CatalogShape | null = null;
let nodeTypes: ReadonlySet<string> | null = null;
let methodNodes: ReadonlyMap<string, string> | null = null;

function catalog(): CatalogShape {
    if (cached) return cached;
    try {
        cached = JSON.parse(
            fs.readFileSync(CATALOG_PATH, 'utf8')
        ) as CatalogShape;
    } catch (error) {
        // No catalog means we cannot tell our nodes apart, and cannot say which
        // node runs a method. Empty is honest; guessing would put a wrong
        // sentence in front of whoever acts on it. Say so, though: a silent
        // empty catalog hides every device link to a flow.
        logMissingCatalog(error);
        cached = {};
    }
    return cached;
}

function logMissingCatalog(error: unknown): void {
    logger.warn(
        'Node-RED catalog %s could not be read; flows will not show which devices they use: %s',
        CATALOG_PATH,
        error
    );
}

export function fleetManagerNodeTypes(): ReadonlySet<string> {
    if (nodeTypes) return nodeTypes;
    nodeTypes = new Set(
        (catalog().nodes ?? []).map((n) => String(n.key ?? '')).filter(Boolean)
    );
    return nodeTypes;
}

export function isFleetManagerNode(type: unknown): boolean {
    return fleetManagerNodeTypes().has(String(type ?? ''));
}

/** One of ours that does something to the fleet. */
export function isActingFleetManagerNode(type: unknown): boolean {
    const key = String(type ?? '');
    return isFleetManagerNode(key) && !NON_ACTING_NODE_TYPES.has(key);
}

/** A tab is one automation. Everything else is wiring inside one. */
export function isFlowTab(record: {type?: unknown}): boolean {
    return record.type === 'tab';
}

function methodNodeIndex(): ReadonlyMap<string, string> {
    if (methodNodes) return methodNodes;
    const index = new Map<string, string>();
    for (const method of catalog().methods ?? []) {
        const full = String(method.fullMethod ?? '');
        if (!full) continue;
        const keys = (method.nodeKeys ?? []).map(String);
        // Prefer the specific node; fall back to the raw RPC node.
        index.set(
            full.toLowerCase(),
            keys.find((key) => key !== GENERIC_NODE_TYPE) ?? GENERIC_NODE_TYPE
        );
    }
    methodNodes = index;
    return methodNodes;
}

/**
 * The node that runs this method, or null if the method does not exist.
 *
 * Null is the answer that stops a made-up method reaching a deploy. The
 * catalog holds every real one, so there is no reason to guess.
 */
export function nodeTypeForMethod(method: string): string | null {
    return methodNodeIndex().get(method.trim().toLowerCase()) ?? null;
}

/** Test seam: the catalog is read once and memoized. */
export function _resetFlowCatalogForTest(): void {
    cached = null;
    nodeTypes = null;
    methodNodes = null;
}
