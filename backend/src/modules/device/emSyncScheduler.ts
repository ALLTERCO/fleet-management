// Pure EM-sync scheduling policy — zero imports so it stays free of the config
// barrel cycle (see emSyncStream.ts) and is testable without any I/O.
//
// Two decisions live here and nowhere else:
//   1. armEmSync   — when may a device run next, and in which lane.
//   2. pickDueEmSyncDevices — who actually runs this tick.
//
// The lane is armed from the OUTCOME of the last pass, never from how stale the
// device's data looks. Data lag freezes permanently on several paths (a
// zero-day seed, a channel with no cursor row, one failing channel), which used
// to pin those devices at the catch-up cadence for good and let them hold every
// slot. What the device actually returned cannot freeze.

export type EmSyncLane = 'live' | 'catchup';

// Healthy live-edge devices wait the gentle cadence plus a stable, bounded
// spread before becoming eligible again. Keep the spread and its exported
// capacity contract together so tests and observability cannot disagree with
// the scheduler.
export const EM_SYNC_JITTER_WINDOW_S = 60;

export function emSyncJitterSeconds(random = Math.random): number {
    return Math.floor(random() * EM_SYNC_JITTER_WINDOW_S);
}

export function emSyncLiveCadenceMaxSeconds(gentleS: number): number {
    // The random window is exclusive (0..59 at the default), so gentle + 60
    // is a conservative integer upper bound suitable for external assertions.
    return Math.max(0, gentleS) + EM_SYNC_JITTER_WINDOW_S;
}

// What one pass produced. 'no_data' means the device offered nothing, which is
// a live-edge answer, NOT a reason to retry hard. 'deferred' means the pass
// ended waiting for database room before it fetched anything.
export type EmSyncChannelOutcome =
    | 'advanced'
    | 'deferred'
    | 'at_edge'
    | 'no_data'
    | 'failed';

export interface EmSyncArming {
    lane: EmSyncLane;
    nextEligibleTs: number;
    failures: number;
}

// Exponent cap keeps the shift finite; the min() below would clamp anyway.
const MAX_BACKOFF_SHIFT = 30;

function backoffDelayS(input: {
    failures: number;
    baseS: number;
    maxS: number;
}): number {
    const shift = Math.min(input.failures, MAX_BACKOFF_SHIFT);
    return Math.min(input.baseS * 2 ** shift, input.maxS);
}

/**
 * Next eligibility for one device, from the outcome of the pass that just
 * finished. Callers stamp a fresh monotonic `seq` alongside this so ties break
 * in completion order; that pairing is what makes the rotation starvation-free.
 */
export function armEmSync(input: {
    outcome: EmSyncChannelOutcome;
    prevLane: EmSyncLane;
    prevFailures: number;
    nowS: number;
    jitterS: number;
    gentleS: number;
    failBaseS: number;
    failMaxS: number;
}): EmSyncArming {
    if (input.outcome === 'advanced') {
        // Still draining real history — keep going, but inside the catch-up
        // reserve where it cannot crowd out live work.
        return {lane: 'catchup', nextEligibleTs: input.nowS, failures: 0};
    }
    if (input.outcome === 'deferred') {
        // Still behind and nothing went wrong: queue again at once, keeping
        // whatever failure count the device already carried.
        return {
            lane: 'catchup',
            nextEligibleTs: input.nowS,
            failures: input.prevFailures
        };
    }
    if (input.outcome === 'failed') {
        // Stay in whatever lane this device was already charged to, so a broken
        // device cannot escape its reserve by failing.
        return {
            lane: input.prevLane,
            failures: input.prevFailures + 1,
            nextEligibleTs:
                input.nowS +
                backoffDelayS({
                    failures: input.prevFailures,
                    baseS: input.failBaseS,
                    maxS: input.failMaxS
                }) +
                input.jitterS
        };
    }
    // 'at_edge' and 'no_data': the device has nothing further to give right now.
    return {
        lane: 'live',
        nextEligibleTs: input.nowS + input.gentleS + input.jitterS,
        failures: 0
    };
}

/**
 * Fold per-channel outcomes into one device outcome. Any channel that pulled
 * history wins, then one still waiting for database room: a device must not
 * be demoted because a sibling channel is broken. An empty channel list is a
 * failure, never a caught-up device.
 */
export function resolveDeviceOutcome(
    outcomes: ReadonlyArray<EmSyncChannelOutcome>
): EmSyncChannelOutcome {
    if (outcomes.length === 0) return 'failed';
    if (outcomes.includes('advanced')) return 'advanced';
    if (outcomes.includes('deferred')) return 'deferred';
    if (outcomes.includes('failed')) return 'failed';
    if (outcomes.includes('no_data')) return 'no_data';
    return 'at_edge';
}

export interface EmSyncCandidate {
    id: string;
    lane: EmSyncLane;
    nextEligibleTs: number;
    // Monotonic, re-stamped on every completion. Orders ties in completion
    // order, which one-second timestamps cannot do.
    seq: number;
    // Channels sync in parallel, so a device costs this many channel slots.
    channels: number;
}

export interface EmSyncPlan {
    dispatch: {id: string; lane: EmSyncLane}[];
    dueLive: number;
    dueCatchup: number;
    // Longest wait among devices that were due and did not get a slot. This is
    // the starvation detector: it counts devices the dispatcher never reached,
    // which per-device lag gauges structurally cannot see.
    oldestUnpickedWaitS: number;
    channelBlocked: boolean;
}

export interface EmSyncCapacityEstimate {
    liveEntriesPerSecond: number;
    recoveryEntriesPerSecond: number;
    recoverySeconds: number;
    sustainable: boolean;
}

/**
 * Capacity rule for restart recovery. The drainer must first exceed the live
 * arrival rate; only the remaining throughput can reduce a backlog.
 */
export function estimateEmSyncCapacity(input: {
    devices: number;
    channelsPerDevice: number;
    cadenceSeconds: number;
    drainEntriesPerSecond: number;
    backlogEntries: number;
}): EmSyncCapacityEstimate {
    const cadence = Math.max(1, input.cadenceSeconds);
    const liveEntriesPerSecond =
        (Math.max(0, input.devices) * Math.max(0, input.channelsPerDevice)) /
        cadence;
    const recoveryEntriesPerSecond =
        input.drainEntriesPerSecond - liveEntriesPerSecond;
    const sustainable = recoveryEntriesPerSecond > 0;
    return {
        liveEntriesPerSecond,
        recoveryEntriesPerSecond,
        recoverySeconds: sustainable
            ? Math.max(0, input.backlogEntries) / recoveryEntriesPerSecond
            : Number.POSITIVE_INFINITY,
        sustainable
    };
}

const byWait = (a: EmSyncCandidate, b: EmSyncCandidate): number =>
    a.nextEligibleTs - b.nextEligibleTs || a.seq - b.seq;

// How many catch-up slots the reserve still owes, after load adaptation. A
// queued live request suspends catch-up outright; a merely hot pool halves it.
// Asymmetric on purpose: load adaptation always outranks lag adaptation.
function reservedNow(input: {
    reservedCatchupSlots: number;
    poolWaiting: boolean;
    poolHot: boolean;
}): number {
    if (input.poolWaiting) return 0;
    if (input.poolHot) return Math.floor(input.reservedCatchupSlots / 2);
    return input.reservedCatchupSlots;
}

// Take from the head while both budgets allow. Stops at the first device that
// does not fit rather than skipping past it, so head-of-line order is kept.
function takeHead(input: {
    queue: ReadonlyArray<EmSyncCandidate>;
    offset: number;
    limit: number;
    channelBudget: number;
}): {taken: EmSyncCandidate[]; channelsUsed: number; blocked: boolean} {
    const taken: EmSyncCandidate[] = [];
    let channelsUsed = 0;
    for (let i = input.offset; i < input.queue.length; i++) {
        if (taken.length >= input.limit) break;
        const next = input.queue[i];
        if (channelsUsed + next.channels > input.channelBudget) {
            return {taken, channelsUsed, blocked: true};
        }
        taken.push(next);
        channelsUsed += next.channels;
    }
    return {taken, channelsUsed, blocked: false};
}

/**
 * Choose which devices sync this tick.
 *
 * Order is (nextEligibleTs, seq) within each lane — never the order the caller
 * iterated its own map, which is device connection order and let whoever
 * connected first hold every slot.
 *
 * Catch-up is reserved by OCCUPANCY (`reservedCatchupSlots - activeCatchupSlots`),
 * not as a share of free slots: under load only one or two slots are ever free
 * and a percentage of that rounds to zero. Both lanes borrow what the other is
 * not using, so an idle live lane does not leave the pool sitting idle during a
 * fleet-wide drain.
 */
export function pickDueEmSyncDevices(input: {
    candidates: ReadonlyArray<EmSyncCandidate>;
    nowS: number;
    availableSlots: number;
    availableChannels: number;
    activeCatchupSlots: number;
    reservedCatchupSlots: number;
    poolWaiting: boolean;
    poolHot: boolean;
    /** Downstream buffer is at its catch-up high-water mark. */
    catchupPaused?: boolean;
}): EmSyncPlan {
    const live: EmSyncCandidate[] = [];
    const catchup: EmSyncCandidate[] = [];
    for (const c of input.candidates) {
        if (c.nextEligibleTs > input.nowS) continue;
        (c.lane === 'catchup' ? catchup : live).push(c);
    }
    live.sort(byWait);
    catchup.sort(byWait);

    const slots = Math.max(0, input.availableSlots);
    const reserved = reservedNow(input);
    const owed = input.catchupPaused
        ? 0
        : Math.min(
              catchup.length,
              Math.max(0, reserved - input.activeCatchupSlots)
          );
    const liveTake = Math.min(live.length, Math.max(0, slots - owed));
    const catchupTake =
        input.poolWaiting || input.catchupPaused
            ? 0
            : Math.min(catchup.length, Math.max(0, slots - liveTake));

    let channelBudget = Math.max(0, input.availableChannels);
    let blocked = false;
    const dispatch: {id: string; lane: EmSyncLane}[] = [];

    const push = (taken: EmSyncCandidate[]) => {
        for (const c of taken) dispatch.push({id: c.id, lane: c.lane});
    };

    // The reserve is filled first so live traffic cannot consume it by arriving
    // earlier in the same tick.
    const owedFill = takeHead({
        queue: catchup,
        offset: 0,
        limit: Math.min(owed, catchupTake),
        channelBudget
    });
    push(owedFill.taken);
    channelBudget -= owedFill.channelsUsed;
    blocked ||= owedFill.blocked;

    const liveFill = takeHead({
        queue: live,
        offset: 0,
        limit: liveTake,
        channelBudget
    });
    push(liveFill.taken);
    channelBudget -= liveFill.channelsUsed;
    blocked ||= liveFill.blocked;

    const restFill = takeHead({
        queue: catchup,
        offset: owedFill.taken.length,
        limit: catchupTake - owedFill.taken.length,
        channelBudget
    });
    push(restFill.taken);
    blocked ||= restFill.blocked;

    const picked = new Set(dispatch.map((d) => d.id));
    let oldestUnpickedWaitS = 0;
    for (const c of [...live, ...catchup]) {
        if (picked.has(c.id)) continue;
        const waited = input.nowS - c.nextEligibleTs;
        if (waited > oldestUnpickedWaitS) oldestUnpickedWaitS = waited;
    }

    return {
        dispatch,
        dueLive: live.length,
        dueCatchup: catchup.length,
        oldestUnpickedWaitS,
        channelBlocked: blocked
    };
}
