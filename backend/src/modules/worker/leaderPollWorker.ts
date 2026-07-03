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
    tick: () => Promise<void>;
    // Optional restart cleanup: run once at start, then every intervalMs.
    reclaim?: {run: () => Promise<void>; intervalMs: number};
}

export interface LeaderPollWorker {
    start: () => Promise<void>;
    stop: () => void;
    // Leader-gated single tick — lets tests drive the worker manually.
    tickOnce: () => Promise<void>;
}

export function createLeaderPollWorker(
    spec: LeaderPollWorkerSpec
): LeaderPollWorker {
    let running = false;
    // Bumped on every stop()/start() so a loop in flight across an await can
    // tell it has been superseded and must not reschedule (no zombie loops).
    let generation = 0;
    let pollHandle: NodeJS.Timeout | null = null;
    let reclaimHandle: NodeJS.Timeout | null = null;

    async function safeReclaim(): Promise<void> {
        if (!spec.reclaim) return;
        try {
            await spec.reclaim.run();
        } catch (err) {
            spec.logger.warn('reclaim failed: %s', formatError(err));
        }
    }

    async function tickOnce(): Promise<void> {
        if (!isLeader(spec.leaderName)) return;
        await spec.tick();
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
        const loop = async () => {
            if (myGen !== generation) return;
            try {
                await tickOnce();
            } catch (err) {
                spec.logger.error('tick failed: %s', formatError(err));
            }
            if (myGen !== generation) return;
            pollHandle = setTimeout(loop, spec.pollIntervalMs());
            pollHandle.unref?.();
        };
        void loop();
    }

    function stop(): void {
        running = false;
        generation++;
        if (pollHandle) {
            clearTimeout(pollHandle);
            pollHandle = null;
        }
        if (reclaimHandle) {
            clearInterval(reclaimHandle);
            reclaimHandle = null;
        }
    }

    return {start, stop, tickOnce};
}
