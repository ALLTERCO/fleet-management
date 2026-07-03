// Holds the device data gathered while a device waits, so accept can assemble
// from it instead of re-fetching. The gather runs at most once per device
// (single-flight — an accept clicked mid-gather shares the in-flight one). A
// failed gather is not kept, so it's re-tried. The entry is dropped when the
// device leaves the waiting room or is accepted.

import type {DeviceDataBundle} from '../../model/ShellyDeviceFactory';
import {BoundedMap} from '../boundedMap';
import {SingleFlight} from '../singleFlight';

const flight = new SingleFlight<string, DeviceDataBundle>('device-gather');
// Bounded + TTL: a gather never consumed (device vanished before accept) is
// evicted rather than pinned. Cleared on accept/leave in the happy path.
const HELD_MAX = 10_000;
const HELD_TTL_MS = 10 * 60 * 1000;
const held = new BoundedMap<string, DeviceDataBundle>({
    maxSize: HELD_MAX,
    ttlMs: HELD_TTL_MS
});
// Keys whose in-flight gather was already taken by an accept — so the gather,
// when it finishes, doesn't re-store a bundle that's already been consumed.
const consumed = new Set<string>();

// Gather once and keep the result; a saved bundle or an in-flight gather is
// reused. A rejection is not kept, so the next call re-gathers.
export async function gatherDeviceDataOnce(
    shellyID: string,
    gather: () => Promise<DeviceDataBundle>
): Promise<DeviceDataBundle> {
    const saved = held.get(shellyID);
    if (saved) return saved;
    const bundle = await flight.run(shellyID, gather);
    // An accept consumed the in-flight result while we gathered — don't re-store.
    if (consumed.delete(shellyID)) return bundle;
    held.set(shellyID, bundle);
    return bundle;
}

// Remove and return the bundle for accept. If the gather is still running
// (accept clicked mid-gather), await it instead of missing it and re-probing.
export async function takeGatheredData(
    shellyID: string
): Promise<DeviceDataBundle | undefined> {
    const saved = held.get(shellyID);
    if (saved) {
        held.delete(shellyID);
        return saved;
    }
    const inflight = flight.peek(shellyID);
    if (!inflight) return undefined;
    consumed.add(shellyID);
    try {
        return await inflight;
    } catch {
        // A failed gather isn't reusable — accept falls back to a fresh probe.
        consumed.delete(shellyID);
        return undefined;
    }
}

export function dropGatheredData(shellyID: string): void {
    held.delete(shellyID);
}

export function hasGatheredData(shellyID: string): boolean {
    return held.has(shellyID);
}

export function clearGatheredDataForTests(): void {
    held.clear();
    consumed.clear();
}
