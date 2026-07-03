// Composes a SessionSnapshot for shutdown by joining:
//   - sessionStreamRegistry  → connectionId per live socket (client-visible)
//   - ConnectionContext      → userId per live socket
//   - clientSubscriptionRegistry → filter per connectionId

import {ConnectionContext} from './ConnectionContext';
import {snapshotByConnectionId} from './clientSubscriptionRegistry';
import {buildSnapshot, type SessionRecord} from './sessionSnapshot';
import {snapshotBindings} from './sessionStreamRegistry';
import type {SubscriberFilter} from './subscriberFilter';

export function composeSnapshot() {
    const filtersByConnectionId = new Map<string, SubscriberFilter>();
    for (const {connectionId, filter} of snapshotByConnectionId()) {
        filtersByConnectionId.set(connectionId, filter);
    }
    const records: SessionRecord[] = [];
    for (const {socket, connectionId} of snapshotBindings()) {
        const userId = ConnectionContext.lookupUserIdBySocket(socket);
        if (userId === undefined) continue;
        records.push(toRecord(userId, connectionId, filtersByConnectionId));
    }
    return buildSnapshot(records);
}

function toRecord(
    userId: SessionRecord['userId'],
    connectionId: string,
    filtersByConnectionId: Map<string, SubscriberFilter>
): SessionRecord {
    const filter = filtersByConnectionId.get(connectionId);
    const deviceIds = filter?.deviceIds ? Array.from(filter.deviceIds) : [];
    const eventTypes = filter?.eventTypes
        ? Array.from(filter.eventTypes)
        : undefined;
    const record: SessionRecord = {userId, connectionId, deviceIds};
    if (eventTypes) record.eventTypes = eventTypes;
    return record;
}
