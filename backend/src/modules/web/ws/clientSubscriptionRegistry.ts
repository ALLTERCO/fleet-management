// Per-socket SubscriberFilter store for the /client endpoint.
// Set via the Client.SetSubscription internal RPC, consulted by SessionStreamSender.
// Maintains a parallel connectionId index so snapshots can enumerate filters at
// shutdown and restore them on the next boot's reconnect.

import type WebSocket from 'ws';
import {
    type SubscriberFilter,
    SubscriberFilterRegistry
} from './subscriberFilter';

const bySocket = new SubscriberFilterRegistry<WebSocket>();
const byConnectionId = new Map<string, SubscriberFilter>();
const connectionIdBySocket = new WeakMap<WebSocket, string>();

export function getClientSubscription(
    socket: WebSocket
): SubscriberFilter | undefined {
    return bySocket.get(socket);
}

export function setClientSubscription(
    socket: WebSocket,
    filter: SubscriberFilter,
    connectionId?: string
): void {
    bySocket.set(socket, filter);
    const cid = connectionId ?? connectionIdBySocket.get(socket);
    if (cid) {
        byConnectionId.set(cid, filter);
        connectionIdBySocket.set(socket, cid);
    }
}

export function attachConnectionId(
    socket: WebSocket,
    connectionId: string
): void {
    connectionIdBySocket.set(socket, connectionId);
    const existing = bySocket.get(socket);
    if (existing) byConnectionId.set(connectionId, existing);
}

export function clearClientSubscription(socket: WebSocket): void {
    bySocket.clear(socket);
    const cid = connectionIdBySocket.get(socket);
    if (cid) byConnectionId.delete(cid);
}

// Used by ConnectionContext on socket close to drop the connectionId index
// even if the filter was never set (or was explicitly cleared).
export function forgetConnectionId(socket: WebSocket): void {
    const cid = connectionIdBySocket.get(socket);
    if (cid) byConnectionId.delete(cid);
}

export function snapshotByConnectionId(): Array<{
    connectionId: string;
    filter: SubscriberFilter;
}> {
    const out: Array<{connectionId: string; filter: SubscriberFilter}> = [];
    for (const [connectionId, filter] of byConnectionId) {
        out.push({connectionId, filter});
    }
    return out;
}

export interface SetSubscriptionParams {
    eventTypes?: string[];
    deviceIds?: string[];
}

export function buildFilterFromParams(
    params: SetSubscriptionParams
): SubscriberFilter {
    const filter: SubscriberFilter = {};
    if (Array.isArray(params.eventTypes) && params.eventTypes.length > 0) {
        filter.eventTypes = new Set(params.eventTypes);
    }
    if (Array.isArray(params.deviceIds) && params.deviceIds.length > 0) {
        filter.deviceIds = new Set(params.deviceIds);
    }
    return filter;
}
