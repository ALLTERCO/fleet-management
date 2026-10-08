// Translates Fleet's wire events into the SDK's neutral vocabulary. This is the
// only module where both names exist, which is what lets `core/` stay free of
// Fleet event constants and lets a template survive a wire rename.

import {
    ALERT_EVENT,
    DEVICE_NOTIFY,
    JOB_EVENT,
    ORGANIZATION_EVENT,
    SHELLY_EVENT,
    WAITING_ROOM_EVENT
} from '@/tools/wsEvents';
import type {ExternalStore} from '../core/external-store';
import {
    FLEET_LIVE_EVENT,
    type FleetConnectionState,
    type FleetLiveEvent,
    type FleetLiveEventName,
    type FleetLiveEvents,
    type FleetLiveRequest
} from '../core/live-events';
import type {FleetEvent, FleetEventTransport} from '../core/transport';

/** Fleet's component-event name for a change to the waiting-room list. */
const WAITING_ROOM_COMPONENT = 'device';
const WAITING_ROOM_UPDATED = 'waiting_room_updated';

type Translation = {
    name: FleetLiveEventName;
    /** The presence a device has after this event; presence events only. */
    online?: boolean;
    /** Only translate when the payload really is this event. One wire method
     * can carry many meanings; `NotifyEvent` carries every component event. */
    matches?: (params: Record<string, unknown>) => boolean;
};

function isWaitingRoomUpdate(params: Record<string, unknown>): boolean {
    const events = params.events;
    if (!Array.isArray(events)) return false;
    return events.some(
        (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            (entry as {component?: unknown}).component ===
                WAITING_ROOM_COMPONENT &&
            (entry as {event?: unknown}).event === WAITING_ROOM_UPDATED
    );
}

// The single home for the wire-to-neutral mapping. The subscribe request is
// derived from it, so a new entry needs no second list.
const TRANSLATIONS: Readonly<Record<string, Translation>> = {
    [SHELLY_EVENT.CONNECT]: {
        name: FLEET_LIVE_EVENT.DEVICE_PRESENCE_CHANGED,
        online: true
    },
    [SHELLY_EVENT.DISCONNECT]: {
        name: FLEET_LIVE_EVENT.DEVICE_PRESENCE_CHANGED,
        online: false
    },
    [SHELLY_EVENT.STATUS]: {name: FLEET_LIVE_EVENT.DEVICE_STATUS_CHANGED},
    [ALERT_EVENT.CREATED]: {name: FLEET_LIVE_EVENT.ALERT_CHANGED},
    [ALERT_EVENT.UPDATED]: {name: FLEET_LIVE_EVENT.ALERT_CHANGED},
    [ALERT_EVENT.RESOLVED]: {name: FLEET_LIVE_EVENT.ALERT_CHANGED},
    [ORGANIZATION_EVENT.PROFILE_UPDATED]: {
        name: FLEET_LIVE_EVENT.ORGANIZATION_PROFILE_CHANGED
    },
    [JOB_EVENT.UPDATED]: {name: FLEET_LIVE_EVENT.JOB_CHANGED},
    [JOB_EVENT.UNIT_UPDATED]: {name: FLEET_LIVE_EVENT.JOB_CHANGED},
    [WAITING_ROOM_EVENT.ACCEPTED]: {
        name: FLEET_LIVE_EVENT.WAITING_ROOM_CHANGED
    },
    [DEVICE_NOTIFY.EVENT]: {
        name: FLEET_LIVE_EVENT.WAITING_ROOM_CHANGED,
        matches: isWaitingRoomUpdate
    }
};

export function wireEventsFor(names: readonly FleetLiveEventName[]): string[] {
    return Object.keys(TRANSLATIONS).filter((wire) =>
        names.includes(TRANSLATIONS[wire].name)
    );
}

/** Returns null for a wire event the neutral vocabulary does not cover. */
export function toFleetLiveEvent(event: FleetEvent): FleetLiveEvent | null {
    const translation = TRANSLATIONS[event.method];
    if (!translation) return null;
    if (translation.matches && !translation.matches(event.params)) return null;
    const shellyID = event.params.shellyID;
    return {
        name: translation.name,
        shellyID: typeof shellyID === 'string' ? shellyID : null,
        ...(translation.online === undefined
            ? {}
            : {online: translation.online}),
        params: event.params
    };
}

export function createFleetLiveEvents(
    transport: FleetEventTransport,
    connection: ExternalStore<FleetConnectionState>
): FleetLiveEvents {
    return {
        connection,
        subscribe(
            request: FleetLiveRequest,
            listener: (event: FleetLiveEvent) => void
        ): Promise<() => void> {
            return transport.subscribe(
                {
                    events: wireEventsFor(request.events),
                    shellyIDs: request.shellyIDs
                },
                (event) => {
                    const live = toFleetLiveEvent(event);
                    if (live) listener(live);
                }
            );
        }
    };
}
