import type {
    JsonRpcId,
    JsonRpcOutgoing,
    JsonRpcOutgoingEvent,
    JsonRpcOutgoingStatus
} from './types';

export function buildRpcRequest(
    id: number,
    method: string,
    params?: object,
    dst?: string
) {
    return {
        jsonrpc: '2.0',
        id,
        src: 'FLEET_MANAGER',
        dst,
        method,
        params
    };
}

export function buildOutgoingJsonRpc(
    id: JsonRpcId,
    dst: string,
    result: any
): JsonRpcOutgoing {
    return {
        jsonrpc: '2.0',
        id,
        src: 'FLEET_MANAGER',
        dst,
        result
    };
}

export function buildOutgoingEvent(
    dst: string,
    component: string,
    event: string
) {
    return {
        src: 'FLEET_MANAGER',
        dst,
        method: 'NotifyEvent',
        params: {
            ts: Date.now(),
            events: [
                {
                    component,
                    event
                }
            ]
        }
    } satisfies JsonRpcOutgoingEvent;
}

export function buildOutgoingStatus(dst: string, patch: object) {
    return {
        src: 'FLEET_MANAGER',
        dst,
        method: 'NotifyStatus',
        params: {
            ts: Date.now(),
            ...patch
        }
    } satisfies JsonRpcOutgoingStatus;
}
