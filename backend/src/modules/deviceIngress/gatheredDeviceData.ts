// Holds the device data gathered while a device waits, so accept can assemble
// from it instead of re-fetching. One run per device (single-flight); every run
// has an owner that can abandon it, because a gather on a dead socket still
// resolves and must never be stored or awaited without end.

import {tuning} from '../../config/tuning';
import type {DeviceDataBundle} from '../../model/ShellyDeviceFactory';
import {BoundedMap} from '../boundedMap';
import {incrementLabeledCounter} from '../observability/counters';
import {SingleFlight} from '../singleFlight';

export type GatherAbandonReason =
    | 'deadline'
    | 'socket_closed'
    | 'take_timeout'
    | 'reclaimed';

export class GatherAbandonedError extends Error {
    constructor(
        readonly reason: GatherAbandonReason,
        // Set on 'deadline' only, so the operator log names the limit that hit.
        readonly deadlineMs?: number
    ) {
        super(`device gather abandoned: ${reason}`);
        this.name = 'GatherAbandonedError';
    }
}

export interface GatherOnceOptions {
    /** Hard deadline for the run. Defaults to tuning.waitingRoom.gatherMaxMs. */
    maxMs?: number;
}

export interface TakeGatheredOptions {
    /** Aborts the wait when the caller's init slot is reclaimed. */
    signal?: AbortSignal;
    /** How long to wait on an in-flight run. Defaults to tuning.waitingRoom.gatherTakeMs. */
    timeoutMs?: number;
}

interface GatherRun {
    readonly controller: AbortController;
    /** The deadline this run was started with, reported when it hits. */
    readonly maxMs: number;
    /** An accept already owns this run's result, so the run must not store it. */
    taken: boolean;
}

interface TakeOutcome {
    bundle?: DeviceDataBundle;
    abandon?: GatherAbandonReason;
}

const flight = new SingleFlight<string, DeviceDataBundle>('device-gather');
// Bounded + TTL: a gather never consumed (device vanished before accept) is
// evicted rather than pinned. Cleared on accept/leave in the happy path.
const HELD_MAX = 10_000;
const HELD_TTL_MS = 10 * 60 * 1000;
const held = new BoundedMap<string, DeviceDataBundle>({
    maxSize: HELD_MAX,
    ttlMs: HELD_TTL_MS
});
// The live run per device, so whoever owns the device's fate can abandon it.
const runs = new Map<string, GatherRun>();

// Gather once and keep the result; a saved bundle or an in-flight gather is
// reused. A rejection is not kept, so the next call re-gathers.
export function gatherDeviceDataOnce(
    shellyID: string,
    gather: (signal: AbortSignal) => Promise<DeviceDataBundle>,
    opts: GatherOnceOptions = {}
): Promise<DeviceDataBundle> {
    const saved = held.get(shellyID);
    if (saved) return Promise.resolve(saved);
    const maxMs = opts.maxMs ?? tuning.waitingRoom.gatherMaxMs;
    return flight.run(shellyID, () => runGather(shellyID, gather, maxMs));
}

async function runGather(
    shellyID: string,
    gather: (signal: AbortSignal) => Promise<DeviceDataBundle>,
    maxMs: number
): Promise<DeviceDataBundle> {
    const run: GatherRun = {
        controller: new AbortController(),
        maxMs,
        taken: false
    };
    runs.set(shellyID, run);
    const timer = setTimeout(
        () => abandonRun(shellyID, run, 'deadline'),
        maxMs
    );
    timer.unref?.();
    try {
        return await settleGather(shellyID, run, gather);
    } finally {
        clearTimeout(timer);
        // Compare-and-delete: an abandoned run must not evict its replacement.
        if (runs.get(shellyID) === run) runs.delete(shellyID);
    }
}

// An abandoned run reports why it was abandoned, whatever the dead transport
// answered, and its bundle is dropped instead of stored.
async function settleGather(
    shellyID: string,
    run: GatherRun,
    gather: (signal: AbortSignal) => Promise<DeviceDataBundle>
): Promise<DeviceDataBundle> {
    try {
        const bundle = await gather(run.controller.signal);
        run.controller.signal.throwIfAborted();
        if (!run.taken) held.set(shellyID, bundle);
        return bundle;
    } catch (error) {
        run.controller.signal.throwIfAborted();
        throw error;
    }
}

function abandonRun(
    shellyID: string,
    run: GatherRun,
    reason: GatherAbandonReason
): void {
    if (run.controller.signal.aborted) return;
    if (runs.get(shellyID) === run) {
        flight.forget(shellyID);
        runs.delete(shellyID);
    }
    const deadlineMs = reason === 'deadline' ? run.maxMs : undefined;
    run.controller.abort(new GatherAbandonedError(reason, deadlineMs));
    incrementLabeledCounter('device_gather_abandoned_total', {reason});
}

// Remove and return the bundle for accept. If the gather is still running
// (accept clicked mid-gather), wait on it instead of re-probing — but only
// until the take deadline or the caller's own signal gives up on it.
export async function takeGatheredData(
    shellyID: string,
    opts: TakeGatheredOptions = {}
): Promise<DeviceDataBundle | undefined> {
    const saved = held.get(shellyID);
    if (saved) {
        held.delete(shellyID);
        return saved;
    }
    const inflight = flight.peek(shellyID);
    const run = runs.get(shellyID);
    if (!inflight || !run) return undefined;
    run.taken = true;
    const outcome = await raceTake(inflight, opts);
    if (outcome.abandon) abandonRun(shellyID, run, outcome.abandon);
    return outcome.bundle;
}

function raceTake(
    inflight: Promise<DeviceDataBundle>,
    opts: TakeGatheredOptions
): Promise<TakeOutcome> {
    const timeoutMs = opts.timeoutMs ?? tuning.waitingRoom.gatherTakeMs;
    const signal = opts.signal;
    return new Promise<TakeOutcome>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        function settle(outcome: TakeOutcome): void {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve(outcome);
        }
        function onAbort(): void {
            settle({abandon: 'reclaimed'});
        }
        timer = setTimeout(() => settle({abandon: 'take_timeout'}), timeoutMs);
        timer.unref?.();
        // A failed gather is not reusable — accept falls back to a fresh probe.
        inflight.then(
            (bundle) => settle({bundle}),
            () => settle({})
        );
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, {once: true});
    });
}

export function dropGatheredData(shellyID: string): void {
    held.delete(shellyID);
    const run = runs.get(shellyID);
    if (run) abandonRun(shellyID, run, 'socket_closed');
}

export function hasGatheredData(shellyID: string): boolean {
    return held.has(shellyID);
}

export function clearGatheredDataForTests(): void {
    for (const [shellyID, run] of runs) {
        abandonRun(shellyID, run, 'socket_closed');
    }
    runs.clear();
    held.clear();
}
