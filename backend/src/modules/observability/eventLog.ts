import {tuning} from '../../config/tuning';
import {BoundedMap} from '../boundedMap';
import {getLevel} from './samplers';
import type {InitFailureEntry, RpcErrorEntry} from './types';

const METRIC_KEY_LIMIT = tuning.observability.metricKeyLimit;

const rpcErrors: RpcErrorEntry[] = [];
const initFailures: InitFailureEntry[] = [];

const wsMessageTypes = new BoundedMap<string, number>({
    maxSize: METRIC_KEY_LIMIT
});

export function recordRpcError(method: string, error: string): void {
    if (getLevel() < 2) return;
    if (rpcErrors.length >= tuning.observability.rpcErrorRingSize)
        rpcErrors.shift();
    rpcErrors.push({method, error, ts: Date.now()});
}

export function getRpcErrors(): readonly RpcErrorEntry[] {
    return rpcErrors;
}

export function recordInitFailure(shellyID: string, error: string): void {
    if (getLevel() < 2) return;
    if (initFailures.length >= tuning.observability.initFailureRingSize)
        initFailures.shift();
    initFailures.push({shellyID, error, ts: Date.now()});
}

export function getInitFailures(): readonly InitFailureEntry[] {
    return initFailures;
}

export function recordWsMessage(method: string): void {
    if (getLevel() < 2) return;
    wsMessageTypes.set(method, (wsMessageTypes.get(method) ?? 0) + 1);
}

export function getWsMessageTypes(): {
    size: number;
    [Symbol.iterator](): IterableIterator<[string, number]>;
} {
    return wsMessageTypes;
}

export function resetEventLog(): void {
    rpcErrors.length = 0;
    initFailures.length = 0;
    wsMessageTypes.clear();
}
