// Bounds waiting-room probe fan-out. A storm of arrivals (e.g. 500 devices at
// once) must not launch 500 simultaneous socket probes and exhaust resources —
// excess waits, and past the queue cap it's dropped (the device re-probes on its
// next report). Fleet-wide, so the limit holds across all connections.
import {tuning} from '../../config';
import * as Observability from '../Observability';
import {BoundedConcurrency} from '../util/boundedConcurrency';

// Concurrency is tunable; queue caps stay fixed as backpressure. Lazy init
// because tuning isn't ready at module load.
const PROBE_QUEUE_MAX = 500;
const GATHER_QUEUE_MAX = 1000;

let probeLimiter: BoundedConcurrency | undefined;
let gatherLimiter: BoundedConcurrency | undefined;

function getProbeLimiter(): BoundedConcurrency {
    if (!probeLimiter) {
        probeLimiter = new BoundedConcurrency(
            tuning.waitingRoom.probeConcurrency,
            PROBE_QUEUE_MAX,
            () => Observability.incrementCounter('waiting_room_probe_dropped')
        );
    }
    return probeLimiter;
}

// Heavier than a card fill (paginated components) — own budget so a slow gather
// can't starve card fills.
function getGatherLimiter(): BoundedConcurrency {
    if (!gatherLimiter) {
        gatherLimiter = new BoundedConcurrency(
            tuning.waitingRoom.gatherConcurrency,
            GATHER_QUEUE_MAX,
            () => Observability.incrementCounter('waiting_room_gather_dropped')
        );
    }
    return gatherLimiter;
}

export function runBoundedProbe(fn: () => Promise<void>): Promise<boolean> {
    return getProbeLimiter().run(fn);
}

export function probeConcurrencyStats(): {active: number; queued: number} {
    return getProbeLimiter().stats();
}

export function runBoundedGather(fn: () => Promise<void>): Promise<boolean> {
    return getGatherLimiter().run(fn);
}

export function gatherConcurrencyStats(): {active: number; queued: number} {
    return getGatherLimiter().stats();
}
