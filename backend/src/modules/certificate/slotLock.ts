// Per-(deviceId, slot) async mutex. Single-FM scope.
// Map key presence (even with empty queue array) means a holder owns the lock.

type Resolver = () => void;

interface QueueEntry {
    resolve: Resolver;
    // Set true by whichever side fires first (timeout vs release).
    // Guards against double-resolve when release races the timeout.
    settled: boolean;
}

const queues = new Map<string, QueueEntry[]>();

function key(deviceId: string, slot: string): string {
    return `${deviceId}:${slot}`;
}

export async function acquire(
    deviceId: string,
    slot: string,
    timeoutMs: number
): Promise<() => void> {
    const k = key(deviceId, slot);
    const existing = queues.get(k);
    if (!existing) {
        queues.set(k, []);
        return () => releaseFirst(k);
    }
    return new Promise<() => void>((resolve, reject) => {
        const entry: QueueEntry = {
            resolve: () => {
                if (entry.settled) return;
                entry.settled = true;
                clearTimeout(timer);
                resolve(() => releaseFirst(k));
            },
            settled: false
        };
        const timer = setTimeout(() => {
            if (entry.settled) return;
            entry.settled = true;
            const q = queues.get(k);
            if (q) {
                const idx = q.indexOf(entry);
                if (idx >= 0) q.splice(idx, 1);
            }
            reject(
                new Error(
                    `slot lock acquire timed out after ${timeoutMs}ms for ${k}`
                )
            );
        }, timeoutMs);
        existing.push(entry);
    });
}

function releaseFirst(k: string): void {
    const q = queues.get(k);
    if (!q) return;
    // Skip entries the timeout already settled; on a race the timeout's
    // splice may not have run yet, so we may see settled entries here.
    while (q.length > 0) {
        const next = q.shift();
        if (next && !next.settled) {
            next.resolve();
            return;
        }
    }
    queues.delete(k);
}

// Test hook.
export function __resetForTests(): void {
    queues.clear();
}
