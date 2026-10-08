// The neutral live-event vocabulary. Fleet's wire event names are translated
// by the application adapter, so renaming one never reaches core or a template.

import type {ExternalStore} from './external-store';

export const FLEET_LIVE_EVENT = {
    DEVICE_PRESENCE_CHANGED: 'device-presence-changed',
    DEVICE_STATUS_CHANGED: 'device-status-changed',
    ALERT_CHANGED: 'alert-changed',
    /** Policy consumers refetch because operational policies live in organization profile metadata. */
    ORGANIZATION_PROFILE_CHANGED: 'organization-profile-changed',
    /** A long-running fleet operation moved: firmware rollout, backup run,
     * certificate or credential push. Fleet-wide, so `shellyID` is null and
     * `shellyIDs` does not narrow it: a device page asking for this name
     * still hears every job, and reads `params.deviceId` to find its own. */
    JOB_CHANGED: 'job-changed',
    /** The set of devices waiting to be admitted changed: one arrived, one was
     * admitted, one was dropped. Fleet-wide, so `shellyID` is null and
     * `shellyIDs` does not narrow it. */
    WAITING_ROOM_CHANGED: 'waiting-room-changed'
} as const;

export type FleetLiveEventName =
    (typeof FLEET_LIVE_EVENT)[keyof typeof FLEET_LIVE_EVENT];

export type FleetLiveEvent = {
    name: FleetLiveEventName;
    /** The device this is about, or null for a fleet-wide event. */
    shellyID: string | null;
    /** The presence the device now has. Set only on a presence change. */
    online?: boolean;
    /** The untranslated payload, for a consumer that needs the detail. */
    params: Record<string, unknown>;
};

/**
 * What a consumer wants to hear about. `shellyIDs` drops the events that name
 * a different device; it cannot narrow an event that names no device, so a
 * fleet-wide name still arrives in full.
 */
export type FleetLiveRequest = {
    events: readonly FleetLiveEventName[];
    shellyIDs?: readonly string[];
};

/**
 * The three honest answers to "is the live feed delivering?". Anything finer
 * is a guess: a connected feed that is quiet is not a broken one, and nothing
 * below the socket can tell a scheduled retry from a dead backend.
 *
 * `disconnected` covers both never-connected and dropped. `everConnected`
 * separates them, so no fourth name is needed to carry the same fact.
 */
export type FleetConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type FleetConnectionState = {
    status: FleetConnectionStatus;
    /**
     * Epoch ms this status began. Disconnected, this is the moment the feed
     * stopped delivering, so "last updated 6 minutes ago" is `since`.
     * Connected, it is the moment it came up: "connected for 3 hours".
     */
    since: number;
    /**
     * True once the feed has connected at least once. This is the difference
     * between a screen that is still starting up and one that has gone dark;
     * when it went dark is `since`, never a timestamp of its own.
     */
    everConnected: boolean;
};

export interface FleetLiveEvents {
    /**
     * The state of the connection these events arrive over. A store, not an
     * event, because a screen must be able to answer "are we up?" on its first
     * render, before anything has changed.
     */
    connection: ExternalStore<FleetConnectionState>;
    /** Release is idempotent and must not disturb another consumer. */
    subscribe(
        request: FleetLiveRequest,
        listener: (event: FleetLiveEvent) => void
    ): Promise<() => void>;
}
