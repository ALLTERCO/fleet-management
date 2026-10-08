// Adapts the Fleet application's existing authenticated connection to the SDK
// transport. It never opens a second connection and never exposes a token.

import {
    addTemporarySubscription,
    type NamespacedEvent,
    onFleetEvent,
    type TemporarySubscription,
    whenConnected
} from '@/tools/websocket';
import {WS_SUBSCRIBED_EVENTS} from '@/tools/wsEvents';
import type {
    FleetEvent,
    FleetSubscriptionRequest,
    FleetTransport
} from '../core/transport';
import {fleetRpcTransport} from './fleet-rpc';

type SubscriptionHandle = {
    temporary: TemporarySubscription | null;
    releaseListener: () => void;
    released: boolean;
};

/**
 * `shellyIDs` can only drop an event that names a different device. An event
 * naming none is fleet-wide (a job, a waiting-room change) and is delivered to
 * everyone who asked for it; dropping it would silently starve a device page
 * that also wants the fleet-wide names.
 */
function matchesRequest(
    request: FleetSubscriptionRequest,
    event: FleetEvent
): boolean {
    if (!request.events.includes(event.method)) return false;
    if (!request.shellyIDs || request.shellyIDs.length === 0) return true;
    const shellyID = event.params.shellyID;
    if (typeof shellyID !== 'string') return true;
    return request.shellyIDs.includes(shellyID);
}

function reportUnsubscribeFailure(cause: unknown): void {
    console.error('[fleet-transport] unsubscribe failed', cause);
}

/**
 * The connect-time subscription already delivers these, under the baseline
 * field policy, and is reissued on every reconnect. Asking for one again would
 * duplicate it and bypass that policy, so only the rest need a server call.
 */
function eventsNeedingServerSubscription(
    request: FleetSubscriptionRequest
): string[] {
    return request.events.filter(
        (event) => !WS_SUBSCRIBED_EVENTS.includes(event)
    );
}

/**
 * Release is synchronous for the caller, asynchronous on the wire. A failed
 * release is recoverable, so report it rather than leave a floating rejection.
 */
function releaseHandle(handle: SubscriptionHandle): void {
    if (handle.released) return;
    handle.released = true;
    handle.releaseListener();
    handle.temporary?.unsubscribe().catch(reportUnsubscribeFailure);
}

export function createFleetAppTransport(): FleetTransport {
    return {
        call: fleetRpcTransport.call,

        async subscribe(
            request: FleetSubscriptionRequest,
            listener: (event: FleetEvent) => void
        ): Promise<() => void> {
            const handle: SubscriptionHandle = {
                temporary: null,
                releaseListener: onFleetEvent((event: NamespacedEvent) => {
                    const fleetEvent: FleetEvent = {
                        method: event.method,
                        params: event.params
                    };
                    if (matchesRequest(request, fleetEvent)) {
                        listener(fleetEvent);
                    }
                }),
                released: false
            };

            const serverEvents = eventsNeedingServerSubscription(request);
            if (serverEvents.length === 0) return () => releaseHandle(handle);

            try {
                // A template mounts while the host connection is still being
                // established, so wait for it rather than failing the request.
                await whenConnected();
                handle.temporary = await addTemporarySubscription(
                    [...(request.shellyIDs ?? [])],
                    serverEvents
                );
            } catch (cause) {
                handle.releaseListener();
                handle.released = true;
                throw cause;
            }

            return () => releaseHandle(handle);
        }
    };
}

/** The one transport the Fleet shell owns for every mounted template. */
export const fleetAppTransport: FleetTransport = createFleetAppTransport();
