// Leader-gated polling worker. The elected FM node runs `tick` every
// `pollIntervalMs`; an optional `reclaim` runs once at start then on its own
// interval (restart cleanup). One home for the start/stop/loop/leader-gate
// scaffolding the timer-poll workers all repeat.

import type {Logger} from 'log4js';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {formatError} from '../util/formatError';

export interface LeaderPollWorkerSpec {
    leaderName: string;
    logger: Logger;
    pollIntervalMs: () => number;
    // Runs only when this node is the leader.
    // Return 0 to activate optional idle backoff, a positive count to reset
    // it, or void to keep the fixed polling contract.
    tick: () => Promise<unknown>;
    // Optional bounded backoff for empty queues. The base interval remains
    // pollIntervalMs(), and successful work restores it immediately.
    idlePollMaxMs?: () => number;
    // Optional restart cleanup: run once at start, then every intervalMs.
    reclaim?: {run: () => Promise<void>; intervalMs: number};
}

export interface LeaderPollWorker {
    start: () => Promise<void>;
    stop: () => void;
    // Leader-gated single tick — lets tests drive the worker manually.
    tickOnce: () => Promise<unknown>;
}

type PollHandle = ReturnType<typeof setTimeout>;
type PollTimer = {
    schedule: (callback: () => void, delayMs: number) => PollHandle;
    clear: (handle: PollHandle) => void;
};

const defaultPollTimer: PollTimer = {
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle)
};
let pollTimer = defaultPollTimer;

export function __setLeaderPollTimerForTests(timer: PollTimer | null): void {
    pollTimer = timer ?? defaultPollTimer;
}

export function createLeaderPollWorker(
    spec: LeaderPollWorkerSpec
): LeaderPollWorker {
    let running = false;
    // Bumped on every stop()/start() so a loop in flight across an await can
    // tell it has been superseded and must not reschedule (no zombie loops).
    let generation = 0;
    let pollHandle: PollHandle | null = null;
    let reclaimHandle: NodeJS.Timeout | null = null;

    async function safeReclaim(): Promise<void> {
        if (!spec.reclaim) return;
        try {
            await spec.reclaim.run();
        } catch (err) {
            spec.logger.warn('reclaim failed: %s', formatError(err));
        }
    }

    async function tickOnce(): Promise<unknown> {
        if (!isLeader(spec.leaderName)) return;
        return spec.tick();
    }

    async function start(): Promise<void> {
        if (running) return;
        running = true;
        const myGen = ++generation;
        void startLeaderGate(spec.leaderName);
        if (spec.reclaim) {
            await safeReclaim();
            reclaimHandle = setInterval(safeReclaim, spec.reclaim.intervalMs);
            reclaimHandle.unref?.();
        }
        let idleDelayMs = spec.pollIntervalMs();
        const loop = async () => {
            if (myGen !== generation) return;
            let processed: unknown = null;
            try {
                processed = await tickOnce();
            } catch (err) {
                spec.logger.error('tick failed: %s', formatError(err));
                idleDelayMs = spec.pollIntervalMs();
            }
            if (myGen !== generation) return;
            const baseDelayMs = spec.pollIntervalMs();
            const delayMs =
                processed === 0 && spec.idlePollMaxMs
                    ? idleDelayMs
                    : baseDelayMs;
            if (processed === 0 && spec.idlePollMaxMs) {
                idleDelayMs = Math.min(
                    Math.max(baseDelayMs, spec.idlePollMaxMs()),
                    idleDelayMs * 2
                );
            } else {
                idleDelayMs = baseDelayMs;
            }
            pollHandle = pollTimer.schedule(loop, delayMs);
            pollHandle.unref?.();
        };
        void loop();
    }

    function stop(): void {
        running = false;
        generation++;
        if (pollHandle) {
            pollTimer.clear(pollHandle);
            pollHandle = null;
        }
        if (reclaimHandle) {
            clearInterval(reclaimHandle);
            reclaimHandle = null;
        }
    }

    return {start, stop, tickOnce};
}
