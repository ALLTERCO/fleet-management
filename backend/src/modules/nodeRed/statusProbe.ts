// Is Node-RED up, and how many flows does it run? Asked by the UI so it can
// say "Node-RED is down" instead of showing a blank editor. The probe has its
// own short timeout and its answer is reused for a while, so a page that polls
// cannot turn into load on Node-RED.

import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {nodeRedAvailable} from './available';
import {isFlowTab} from './flowCatalog';
import {nodeRedAdminHeaders, nodeRedAdminUrl} from './flowClient';
import {nodeRedLockedOrg} from './orgLock';

const logger = log4js.getLogger('node-red-status');

export interface NodeRedStatus {
    enabled: boolean;
    reachable: boolean;
    orgId?: string;
    flowCount?: number;
    checkedAt: string;
}

type Probe = () => Promise<number>;

let cached: {value: NodeRedStatus; expiresAt: number} | null = null;
let inflight: Promise<NodeRedStatus> | null = null;

function countTabs(payload: unknown): number {
    const flows = (payload as {flows?: unknown})?.flows;
    if (!Array.isArray(flows)) {
        throw new TypeError('Node-RED returned an invalid flow response');
    }
    return flows.filter(
        (record) => typeof record === 'object' && record && isFlowTab(record)
    ).length;
}

/** Reads the flow count with the short status timeout. Throws when down. */
async function probeFlowCount(): Promise<number> {
    const res = await fetch(nodeRedAdminUrl('/flows'), {
        headers: {
            ...nodeRedAdminHeaders(),
            'Node-RED-API-Version': 'v2',
            accept: 'application/json'
        },
        signal: AbortSignal.timeout(tuning.nodeRed.statusTimeoutMs)
    });
    if (!res.ok) throw new Error(`Node-RED returned ${res.status}`);
    return countTabs(await res.json());
}

let probe: Probe = probeFlowCount;

function baseStatus(): Omit<NodeRedStatus, 'reachable'> {
    const orgId = nodeRedLockedOrg();
    return {
        enabled: nodeRedAvailable(),
        checkedAt: new Date().toISOString(),
        ...(orgId ? {orgId} : {})
    };
}

function unreachable(error: unknown): NodeRedStatus {
    logger.warn('Node-RED health probe failed: %s', error);
    return {...baseStatus(), reachable: false};
}

function checkNow(): Promise<NodeRedStatus> {
    if (!nodeRedAvailable()) {
        return Promise.resolve({...baseStatus(), reachable: false});
    }
    return probe().then(
        (flowCount) => ({...baseStatus(), reachable: true, flowCount}),
        unreachable
    );
}

async function refresh(): Promise<NodeRedStatus> {
    const value = await checkNow();
    cached = {value, expiresAt: Date.now() + tuning.nodeRed.statusCacheMs};
    return value;
}

/** Current Node-RED health, at most `statusCacheMs` old. Never throws. */
export function readNodeRedStatus(): Promise<NodeRedStatus> {
    if (cached && cached.expiresAt > Date.now()) {
        return Promise.resolve(cached.value);
    }
    inflight ??= refresh().finally(() => {
        inflight = null;
    });
    return inflight;
}

/** Test seam: swap the probe and forget the cached answer. */
export function _setStatusProbeForTest(next: Probe | null): void {
    probe = next ?? probeFlowCount;
    cached = null;
    inflight = null;
}
