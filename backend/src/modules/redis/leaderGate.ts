// Named-lease helper so multiple subsystems can share the same primitive.
// Workers register a lease at start, sample isLeader(name) at tick-time.

import log4js from 'log4js';
import {Leadership} from './Leadership';

const logger = log4js.getLogger('leader-gate');
const gates = new Map<string, Leadership>();

export async function startLeaderGate(name: string): Promise<void> {
    if (gates.has(name)) return;
    const lease = new Leadership({name});
    gates.set(name, lease);
    try {
        await lease.start();
    } catch (err) {
        logger.warn('leader gate %s start failed: %s', name, err);
    }
}

let testOverride: ((name: string) => boolean) | null = null;
export function isLeader(name: string): boolean {
    if (testOverride) return testOverride(name);
    return gates.get(name)?.isLeader() ?? false;
}

// Test seam: force isLeader() to return a deterministic value so
// the worker tick path is exercisable without a real Redis lease.
export function __setIsLeaderOverrideForTests(
    fn: ((name: string) => boolean) | null
): void {
    testOverride = fn;
}

export async function stopLeaderGates(): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const [, lease] of gates) stops.push(lease.stop());
    gates.clear();
    await Promise.allSettled(stops);
}
