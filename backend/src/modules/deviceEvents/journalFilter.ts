// Decides which status deltas belong in device.event_log. The merge diff fires
// on every ticking float, so an energy meter alone produces ~22 deltas per
// message — telemetry, not state. Telemetry already has two homes
// (device.status, device_em.stats); the journal keeps only what changed about
// the device itself.

import {isMeteredFloatField} from '../../config/shelly.dataTypes';
import type {PathChange} from '../../types';

// Retick on every message and carry no state of their own. The device clock is
// already recorded as the entry's `ts`, and free RAM is a gauge.
const NEVER_JOURNALLED = new Set(['sys.time', 'sys.unixtime', 'sys.ram_free']);

// dBm ceilings for the usual wifi quality bands. Crossing one is a signal
// event worth keeping; a 1 dBm wobble inside a band is not.
const SIGNAL_BAND_CEILINGS = [-50, -60, -70, -80];

type ChangeTest = (change: PathChange) => boolean;

function toFiniteNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value;
}

/** Uptime only counts up, so a lower value means the device restarted. */
function restarted(change: PathChange): boolean {
    const before = toFiniteNumber(change.prev);
    const after = toFiniteNumber(change.next);
    if (before === undefined || after === undefined) return true;
    return after < before;
}

function signalBand(rssi: number): number {
    let band = 0;
    for (const ceiling of SIGNAL_BAND_CEILINGS) {
        if (rssi < ceiling) band++;
    }
    return band;
}

/** Signal strength matters when the quality band moves, not on every sample. */
function changedSignalBand(change: PathChange): boolean {
    const before = toFiniteNumber(change.prev);
    const after = toFiniteNumber(change.next);
    if (before === undefined || after === undefined) return true;
    return signalBand(before) !== signalBand(after);
}

// Paths whose raw value is noise but whose transition is a real event.
const TRANSITION_TESTS: Record<string, ChangeTest> = {
    'sys.uptime': restarted,
    'wifi.rssi': changedSignalBand
};

/** Does this delta describe a device state change worth journalling? */
export function isJournalWorthy(change: PathChange): boolean {
    if (NEVER_JOURNALLED.has(change.path)) return false;
    const transitionTest = TRANSITION_TESTS[change.path];
    if (transitionTest) return transitionTest(change);
    return !isMeteredFloatField(change.path);
}
