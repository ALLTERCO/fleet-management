import type {EventEmitter} from 'node:events';
import {getLogger} from 'log4js';
import {incrementCounter} from '../observability/counters';

const logger = getLogger('fault');

// Two different things reach these helpers, and they must be treated
// differently.
//
// reportContainedFault: an UNEXPECTED fault in our own code (a throw inside a
// timer, a callback that should never fail). This is a bug. Log it loud and
// count fm_contained_faults so ops can alert and we fix the root cause. Keep
// this channel clean — if it moves, something is genuinely wrong.
export function reportContainedFault(source: string, err: unknown): void {
    logger.error(
        'contained fault [%s]: %s',
        source,
        err instanceof Error ? (err.stack ?? err.message) : String(err)
    );
    incrementCounter('contained_faults');
}

// reportHandledPeerError: an EXPECTED event caused by the outside world (a peer
// resets the TCP connection, a device sends a malformed frame, a client
// disconnects mid-response). Not our bug, and it cannot be "fixed" — it is the
// normal cost of networking. Count fm_peer_errors for the true rate, and surface
// a visible warn per source so a misbehaving device is findable — but throttled
// so a flapping peer cannot flood stdout (same shape as the pg pool idle log).
const PEER_LOG_INTERVAL_MS = 60_000;
const peerLogLastAt = new Map<string, number>();

export function reportHandledPeerError(source: string, err: unknown): void {
    incrementCounter('peer_errors');
    const message = err instanceof Error ? err.message : String(err);
    const now = Date.now();
    if (now - (peerLogLastAt.get(source) ?? 0) >= PEER_LOG_INTERVAL_MS) {
        peerLogLastAt.set(source, now);
        logger.warn('handled peer error [%s]: %s', source, message);
    } else {
        logger.debug('handled peer error [%s]: %s', source, message);
    }
}

// Run fn now, containing a sync throw or a rejected async return as a fault.
export function runContained(
    source: string,
    fn: () => void | Promise<void>
): void {
    try {
        const result = fn();
        if (result instanceof Promise) {
            result.catch((err) => reportContainedFault(source, err));
        }
    } catch (err) {
        reportContainedFault(source, err);
    }
}

// setInterval whose callback can never crash the process. A throw here is a bug
// in our own code, so it goes to the loud fault channel.
export function safeInterval(
    source: string,
    ms: number,
    fn: () => void | Promise<void>
): NodeJS.Timeout {
    return setInterval(() => runContained(source, fn), ms);
}

// Wrap a sync event listener so a throw in its body cannot escape emit(). A
// throw in our listener body is our bug, so it is a fault.
export function guardListener<A extends unknown[]>(
    source: string,
    fn: (...args: A) => void
): (...args: A) => void {
    return (...args: A) => {
        try {
            fn(...args);
        } catch (err) {
            reportContainedFault(source, err);
        }
    };
}

// Attach a persistent 'error' listener so an async stream error (e.g. ENOSPC) is
// captured, not thrown. A disk/IO error is a real infrastructure fault, so it is
// loud. Returns a probe that rethrows it at the next await so the owning
// operation fails through its own try/catch and cleans up.
export function captureStreamError(
    stream: EventEmitter,
    source: string
): () => void {
    let captured: Error | null = null;
    stream.on('error', (err: unknown) => {
        if (captured) return;
        captured = err instanceof Error ? err : new Error(String(err));
        reportContainedFault(source, captured);
    });
    return () => {
        if (captured) throw captured;
    };
}
