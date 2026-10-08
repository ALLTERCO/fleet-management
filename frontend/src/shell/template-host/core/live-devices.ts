// A device list that keeps itself current from neutral live events. Status
// and presence patches are applied in place. A device the list has never seen
// is read by id, in one debounced batch, because a site or a simulator coming
// back announces many devices at once. The whole list is never read again for
// an event.

import type {HostDeviceListParams} from './data-contract';
import {
    mergeHostDeviceStatusPatch,
    patchHostDeviceStatus,
    presenceFields
} from './device-mapper';
import type {HostDeviceListPage} from './domains/devices';
import type {ExternalStore} from './external-store';
import {
    FLEET_LIVE_EVENT,
    type FleetLiveEvent,
    type FleetLiveEvents
} from './live-events';
import {createResource, type FleetResource} from './resource';
import {createSessionGuard, type FleetSessionIdentity} from './session';
import type {HostDevice} from './types';

/** A burst of arrivals is one read, not one per device. */
export const UNKNOWN_DEVICE_REFRESH_MS = 300;
/** device.list reads at most this many named devices in one call. */
export const UNKNOWN_DEVICE_BATCH_MAX = 100;
/** A device the scope did not return is asked about again after this long. */
export const OUTSIDE_SCOPE_RECHECK_MS = 5 * 60_000;
/** Bounds the memory of devices outside the scope. */
const OUTSIDE_SCOPE_MAX = 20_000;
/** device.list's largest page. */
const DEVICE_PAGE_LIMIT = 1000;

const NO_DEVICES: readonly HostDevice[] = [];

/**
 * Every device of one scope, page by page. The cursor names the last row read,
 * so a device added while loading neither repeats nor pushes one out.
 */
export async function loadDevicesByCursor(
    readPage: (params: HostDeviceListParams) => Promise<HostDeviceListPage>,
    params: HostDeviceListParams
): Promise<HostDevice[]> {
    const devices: HostDevice[] = [];
    let cursor: string | null = null;
    do {
        const page: HostDeviceListPage = await readPage({
            ...params,
            limit: DEVICE_PAGE_LIMIT,
            ...(cursor ? {cursor} : {})
        });
        devices.push(...page.items);
        cursor = page.next_cursor;
    } while (cursor);
    return devices;
}

export type LiveDevicesOptions = {
    load: () => Promise<readonly HostDevice[]>;
    /**
     * One read of the named devices, in the same scope as `load`. A device it
     * does not return is outside the scope. Without it, events for devices the
     * list has never seen are ignored.
     */
    loadByIds?: (
        shellyIDs: readonly string[]
    ) => Promise<readonly HostDevice[]>;
    live: FleetLiveEvents;
    /** Narrows the live feed to these devices; absent means the whole fleet. */
    shellyIDs?: readonly string[];
    /** Identity this data belongs to. A change discards it. */
    session?: ExternalStore<FleetSessionIdentity>;
};

export type LiveDevices = FleetResource<readonly HostDevice[]> & {
    /** Opens the live feed. The returned function closes it. Re-callable. */
    listen(): () => void;
};

type PendingDeviceChange = {
    online?: boolean;
    status: Record<string, unknown>;
};

function reportFeedFailure(cause: unknown): void {
    console.error('[live-devices] live feed failed', cause);
}

/** Returns the patched list, or null when the device is not in it. */
function withPresence(
    devices: readonly HostDevice[],
    shellyID: string,
    online: boolean
): readonly HostDevice[] | null {
    let found = false;
    const patched = devices.map((device) => {
        if (device.shellyID !== shellyID) return device;
        found = true;
        return {...device, ...presenceFields(online)};
    });
    return found ? patched : null;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/** Returns the patched list, or null when this event names no loaded device. */
function withStatus(
    devices: readonly HostDevice[],
    shellyID: string,
    patch: Record<string, unknown>
): readonly HostDevice[] | null {
    let found = false;
    const patched = devices.map((device) => {
        if (device.shellyID !== shellyID) return device;
        found = true;
        return patchHostDeviceStatus(device, patch);
    });
    return found ? patched : null;
}

export function createLiveDevices(options: LiveDevicesOptions): LiveDevices {
    const resource = createResource<readonly HostDevice[]>({
        load: options.load,
        initial: NO_DEVICES,
        session: options.session,
        // The feed patching this list is the one whose loss makes it stale.
        connection: options.live.connection
    });
    const session = createSessionGuard(options.session);
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    let reading = false;
    // Bumped when listening stops, so a read that outlives it is dropped.
    let generation = 0;
    const unknownIds = new Set<string>();
    const outsideScope = new Map<string, number>();
    let releaseFeed: (() => void) | null = null;
    let releaseSession: (() => void) | null = null;
    let disposed = false;
    const pendingChanges = new Map<string, PendingDeviceChange>();
    // Closing the feed is queued behind the work already on the chain, so an
    // event can still be delivered after the caller stopped listening.
    let listening = false;
    // Opening and closing the feed run in order. Without that, the release a
    // remount issues can land after the new subscription and close it.
    let feedWork: Promise<void> = Promise.resolve();

    function queuePendingChange(
        shellyID: string,
        change: {online?: boolean; status?: Record<string, unknown>}
    ): void {
        const current = pendingChanges.get(shellyID) ?? {status: {}};
        pendingChanges.set(shellyID, {
            ...(change.online === undefined
                ? current.online === undefined
                    ? {}
                    : {online: current.online}
                : {online: change.online}),
            status: change.status
                ? mergeHostDeviceStatusPatch(current.status, change.status)
                : current.status
        });
    }

    function flushPendingChanges(): void {
        if (!listening || pendingChanges.size === 0) return;
        const snapshot = resource.getSnapshot();
        if (snapshot.status !== 'ready') return;
        const changes = [...pendingChanges.entries()];
        pendingChanges.clear();
        let devices = snapshot.data;
        for (const [shellyID, change] of changes) {
            let patched: readonly HostDevice[] | null = devices;
            if (change.online !== undefined) {
                patched = withPresence(devices, shellyID, change.online);
                if (patched !== null) devices = patched;
            }
            if (Object.keys(change.status).length > 0) {
                patched = withStatus(devices, shellyID, change.status);
                if (patched !== null) devices = patched;
            }
            if (patched === null) noteUnknown(shellyID);
        }
        if (devices !== snapshot.data) resource.setData(devices);
    }

    const releasePendingWatch = resource.subscribe(flushPendingChanges);

    function knownOutsideScope(shellyID: string): boolean {
        const until = outsideScope.get(shellyID);
        if (until === undefined) return false;
        if (until > Date.now()) return true;
        outsideScope.delete(shellyID);
        return false;
    }

    function markOutsideScope(shellyID: string): void {
        outsideScope.delete(shellyID);
        outsideScope.set(shellyID, Date.now() + OUTSIDE_SCOPE_RECHECK_MS);
        // Map order is insertion order, so the first key is the oldest.
        if (outsideScope.size > OUTSIDE_SCOPE_MAX) {
            const oldest = outsideScope.keys().next().value;
            if (oldest !== undefined) outsideScope.delete(oldest);
        }
    }

    function noteUnknown(shellyID: string): void {
        if (!options.loadByIds || knownOutsideScope(shellyID)) return;
        unknownIds.add(shellyID);
        scheduleRead();
    }

    function scheduleRead(): void {
        if (readTimer !== null || reading) return;
        readTimer = setTimeout(() => {
            readTimer = null;
            void readUnknown();
        }, UNKNOWN_DEVICE_REFRESH_MS);
    }

    function cancelRead(): void {
        unknownIds.clear();
        if (readTimer === null) return;
        clearTimeout(readTimer);
        readTimer = null;
    }

    function takeUnknownBatch(): string[] {
        const batch = [...unknownIds].slice(0, UNKNOWN_DEVICE_BATCH_MAX);
        for (const shellyID of batch) unknownIds.delete(shellyID);
        return batch;
    }

    /** Adds or replaces the devices read by id; the rest are out of scope. */
    function mergeRead(
        requested: readonly string[],
        found: readonly HostDevice[]
    ): void {
        const snapshot = resource.getSnapshot();
        if (snapshot.status !== 'ready') return;
        const byId = new Map(found.map((device) => [device.shellyID, device]));
        for (const shellyID of requested) {
            if (!byId.has(shellyID)) markOutsideScope(shellyID);
        }
        if (byId.size === 0) return;
        const merged = snapshot.data.map((device) => {
            const next = byId.get(device.shellyID);
            if (!next) return device;
            byId.delete(device.shellyID);
            return next;
        });
        resource.setData([...merged, ...byId.values()]);
    }

    async function readUnknown(): Promise<void> {
        const loadByIds = options.loadByIds;
        const batch = takeUnknownBatch();
        if (!listening || !loadByIds || batch.length === 0) return;
        const readGeneration = generation;
        reading = true;
        try {
            const found = await loadByIds(batch);
            if (readGeneration === generation) mergeRead(batch, found);
        } catch (cause) {
            reportFeedFailure(cause);
        } finally {
            reading = false;
            if (unknownIds.size > 0 && readGeneration === generation) {
                scheduleRead();
            }
        }
    }

    function onPresenceChanged(event: FleetLiveEvent): void {
        if (!listening) return;
        if (event.shellyID === null || event.online === undefined) return;
        const snapshot = resource.getSnapshot();
        if (snapshot.status === 'loading') {
            queuePendingChange(event.shellyID, {online: event.online});
            return;
        }
        if (snapshot.status !== 'ready') return;
        const patched = withPresence(
            snapshot.data,
            event.shellyID,
            event.online
        );
        if (patched === null) {
            noteUnknown(event.shellyID);
            return;
        }
        resource.setData(patched);
    }

    function onStatusChanged(event: FleetLiveEvent): void {
        if (!listening || event.shellyID === null) return;
        const status = record(event.params.status);
        if (Object.keys(status).length === 0) return;
        const snapshot = resource.getSnapshot();
        if (snapshot.status === 'loading') {
            queuePendingChange(event.shellyID, {status});
            return;
        }
        if (snapshot.status !== 'ready') return;
        const patched = withStatus(snapshot.data, event.shellyID, status);
        if (patched === null) {
            noteUnknown(event.shellyID);
            return;
        }
        resource.setData(patched);
    }

    function onDeviceChanged(event: FleetLiveEvent): void {
        if (event.name === FLEET_LIVE_EVENT.DEVICE_STATUS_CHANGED) {
            onStatusChanged(event);
            return;
        }
        onPresenceChanged(event);
    }

    function queueFeedWork(step: () => Promise<void> | void): void {
        feedWork = feedWork.then(step).catch(reportFeedFailure);
    }

    function stopListening(): void {
        listening = false;
        generation += 1;
        pendingChanges.clear();
        outsideScope.clear();
        cancelRead();
        queueFeedWork(() => {
            releaseFeed?.();
            releaseFeed = null;
        });
    }

    /** The new identity gets its own feed. Signed out there is none to open. */
    function moveFeedToNewIdentity(): void {
        stopListening();
        if (session.signedOut()) return;
        listen();
    }

    /** One feed per resource: listening again while open changes nothing. */
    function listen(): () => void {
        listening = true;
        // A feed opened for one identity must not keep delivering to the next
        // one, so opening it is what arms the watch that moves it.
        releaseSession ??= session.watch(moveFeedToNewIdentity);
        queueFeedWork(async () => {
            if (releaseFeed || disposed) return;
            releaseFeed = await options.live.subscribe(
                {
                    events: [
                        FLEET_LIVE_EVENT.DEVICE_PRESENCE_CHANGED,
                        FLEET_LIVE_EVENT.DEVICE_STATUS_CHANGED
                    ],
                    shellyIDs: options.shellyIDs
                },
                onDeviceChanged
            );
        });
        return stopListening;
    }

    function releaseWatch(): void {
        releaseSession?.();
        releaseSession = null;
    }

    return {
        ...resource,
        listen,
        detach() {
            releaseWatch();
            stopListening();
            resource.detach();
        },
        dispose() {
            disposed = true;
            releasePendingWatch();
            releaseWatch();
            stopListening();
            resource.dispose();
        }
    };
}
