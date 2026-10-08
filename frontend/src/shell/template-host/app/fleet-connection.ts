// Turns Fleet's own socket flags into the neutral connection state. This is the
// only module where both vocabularies exist, so core never learns that Fleet's
// live feed is a WebSocket at all.

import {
    getConnectionSnapshot,
    onConnectionChange,
    type WsConnectionSnapshot
} from '@/tools/websocket';
import {createExternalStore, type ExternalStore} from '../core/external-store';
import type {
    FleetConnectionState,
    FleetConnectionStatus
} from '../core/live-events';

export function toFleetConnectionStatus(
    snapshot: WsConnectionSnapshot
): FleetConnectionStatus {
    if (snapshot.connected) return 'connected';
    return snapshot.connecting ? 'connecting' : 'disconnected';
}

function toFleetConnectionState(
    snapshot: WsConnectionSnapshot
): FleetConnectionState {
    return {
        status: toFleetConnectionStatus(snapshot),
        since: snapshot.changedAt,
        everConnected: snapshot.everConnected
    };
}

/** Read-only outward: nothing outside this module may state the connection. */
export type FleetConnection = ExternalStore<FleetConnectionState> & {
    /** Stops following the Fleet connection. Idempotent. */
    dispose(): void;
};

/**
 * Two socket flags collapse into three statuses, so the same status is reached
 * by more than one flag pair. Republishing on every flag change would restart
 * `since` for a move a template cannot see, so only a real status change is
 * published and `since` stays the moment that status began.
 */
export function createFleetConnection(): FleetConnection {
    const store = createExternalStore<FleetConnectionState>(
        toFleetConnectionState(getConnectionSnapshot())
    );
    const release = onConnectionChange(() => {
        const next = toFleetConnectionState(getConnectionSnapshot());
        const current = store.getSnapshot();
        if (
            next.status === current.status &&
            next.everConnected === current.everConnected
        ) {
            return;
        }
        store.setSnapshot(next);
    });
    let released = false;

    return {
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        dispose() {
            if (released) return;
            released = true;
            release();
        }
    };
}
