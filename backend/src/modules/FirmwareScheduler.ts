import * as log4js from 'log4js';
import {tuning} from '../config/tuning';
import type FirmwareComponent from '../model/component/FirmwareComponent';
import * as Commander from './Commander';
import * as Observability from './Observability';
import {isLeader, startLeaderGate} from './redis/leaderGate';
import {kv, reservation} from './redis/services';

const logger = log4js.getLogger('FirmwareScheduler');
const LEADER_NAME = 'firmware-scheduler';
// Persisted across leader flips — without this a flip mid-week would
// compute msUntilNextSunday3AM() afresh and skip the current week's run.
const NEXT_TARGET_REDIS_KEY = 'fm:firmware-scheduler:next-target-ms';
const FIRE_CLAIM_KEY_PREFIX = 'fm:firmware-scheduler:fired:';

let schedulerTimeout: NodeJS.Timeout | null = null;
let schedulerRunning = false;
let nextTargetMs = 0;

async function loadPersistedTarget(): Promise<number> {
    try {
        const raw = await kv.get(NEXT_TARGET_REDIS_KEY);
        const parsed = raw ? Number(raw) : 0;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (err) {
        logger.warn('failed to load persisted next-target: %s', err);
        return 0;
    }
}

async function persistTarget(ms: number): Promise<void> {
    try {
        await kv.set(NEXT_TARGET_REDIS_KEY, String(ms));
    } catch (err) {
        logger.warn('failed to persist next-target: %s', err);
    }
}

/**
 * Get the FirmwareComponent from Commander
 */
function getFirmwareComponent(): FirmwareComponent | null {
    const component = Commander.getComponent('firmware');
    if (!component) {
        logger.warn('FirmwareComponent not found');
        return null;
    }
    return component as FirmwareComponent;
}

// Atomic once-per-slot claim — authoritative guard, since a stale isLeader
// flag across a hand-off could let two pods both pass the leader check.
async function claimFireSlot(slotMs: number): Promise<boolean> {
    const key = `${FIRE_CLAIM_KEY_PREFIX}${slotMs}`;
    const ttl = tuning.firmware.schedulerFireClaimTtlSec;
    try {
        const res = await reservation.reserve(key, 1, ttl);
        return res.ok;
    } catch (err) {
        // Fail closed: if the claim can't be confirmed, do not fire — a missed
        // weekly run is recoverable; a double fleet-wide fan-out is not.
        logger.error(
            'firmware fire-slot claim failed slot=%d: %s',
            slotMs,
            err
        );
        return false;
    }
}

/**
 * Run the auto-update check
 */
// Returns true when this pod actually ran the fan-out (won the slot claim).
async function runAutoUpdate(slotMs: number): Promise<boolean> {
    // Leader only — fast pre-filter so followers don't all race the claim.
    if (!isLeader(LEADER_NAME)) {
        logger.info('Skipping firmware auto-update — not leader');
        return false;
    }
    if (!(await claimFireSlot(slotMs))) {
        logger.info(
            'Skipping firmware auto-update — slot %d already claimed',
            slotMs
        );
        return false;
    }
    logger.info('Running scheduled firmware auto-update check...');

    const firmwareComponent = getFirmwareComponent();
    if (!firmwareComponent) {
        return true;
    }

    try {
        const result = await firmwareComponent.runAutoUpdate();
        logger.info(
            'Scheduled auto-update completed: checked=%d, queued=%d, failed=%d',
            result.checked,
            result.queued,
            result.failed
        );
    } catch (error: any) {
        logger.error('Scheduled auto-update failed:', error?.message || error);
    }
    return true;
}

// Advance the target by 7d and skip missed slots if a run overran.
function advanceTarget(): void {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let missed = 0;
    while (nextTargetMs <= now) {
        nextTargetMs += weekMs;
        missed++;
    }
    if (missed > 1) {
        Observability.incrementCounter(
            'firmware_scheduler_missed_runs',
            missed - 1
        );
        logger.warn(
            'firmware scheduler skipped %d missed weekly slot(s)',
            missed - 1
        );
    }
}

async function scheduleNextRun(logPrefix: string): Promise<void> {
    if (!schedulerRunning) {
        return;
    }
    if (schedulerTimeout) {
        clearTimeout(schedulerTimeout);
        schedulerTimeout = null;
    }
    // Always reconcile with the persisted value before computing the next
    // target. Non-leader pods would otherwise advance their local copy
    // every cycle and drift ahead of Redis; on a leader handoff the new
    // leader's local value (already advanced) would be used and a week
    // could be silently skipped. max() keeps the future-most target.
    const persisted = await loadPersistedTarget();
    if (persisted > nextTargetMs) nextTargetMs = persisted;
    if (nextTargetMs <= 0) {
        nextTargetMs = Date.now() + msUntilNextSunday3AM();
    } else {
        advanceTarget();
    }
    // Only the leader writes the shared target so non-leader timers can't
    // clobber it. Followers keep their armed timer so failover is fast.
    if (isLeader(LEADER_NAME)) {
        await persistTarget(nextTargetMs);
    }
    const msUntilNextRun = Math.max(0, nextTargetMs - Date.now());
    // Capture the armed slot so all leaders firing for the same slot derive the
    // same claim key (nextTargetMs is shared/reconciled via Redis).
    const armedSlotMs = nextTargetMs;
    logger.info(
        '%s Next run: %s',
        logPrefix,
        new Date(nextTargetMs).toISOString()
    );
    schedulerTimeout = setTimeout(async () => {
        schedulerTimeout = null;
        if (!schedulerRunning) return;
        try {
            await runAutoUpdate(armedSlotMs);
        } catch (err) {
            logger.error('%s run failed: %s', logPrefix, err);
        } finally {
            await scheduleNextRun(
                'Firmware auto-update scheduler run completed.'
            ).catch((err) =>
                logger.error('%s reschedule failed: %s', logPrefix, err)
            );
        }
    }, msUntilNextRun);
    schedulerTimeout.unref?.();
}

/**
 * Calculate milliseconds until next Sunday at 03:00 UTC
 */
function msUntilNextSunday3AM(): number {
    const now = new Date();
    const nextSunday = new Date(now);

    // Find next Sunday in UTC (including today if it is Sunday)
    const daysUntilSunday = (7 - now.getUTCDay()) % 7;
    nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);

    // Set to 3 AM UTC (predictable across timezones/DST)
    nextSunday.setUTCHours(3, 0, 0, 0);

    // If we're already past that time, go to next week
    if (nextSunday.getTime() <= now.getTime()) {
        nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
    }

    return nextSunday.getTime() - now.getTime();
}

/**
 * Start the firmware auto-update scheduler.
 * Runs every Sunday at 3 AM.
 */
export function startScheduler(): void {
    if (schedulerRunning) {
        logger.warn('Scheduler already running');
        return;
    }
    schedulerRunning = true;
    void startLeaderGate(LEADER_NAME);
    void scheduleNextRun('Firmware auto-update scheduler started.');
}

/**
 * Stop the firmware auto-update scheduler.
 */
export function stopScheduler(): void {
    schedulerRunning = false;
    if (schedulerTimeout) {
        clearTimeout(schedulerTimeout);
        schedulerTimeout = null;
    }
    logger.info('Firmware auto-update scheduler stopped');
}

/**
 * Check if scheduler is running
 */
export function isRunning(): boolean {
    return schedulerRunning;
}

// Test seam: exercise the slot-claim double-fire guard without the timer.
export async function __runAutoUpdateForTests(
    slotMs: number
): Promise<boolean> {
    return runAutoUpdate(slotMs);
}

Observability.registerModule('firmwareScheduler', {
    stats: () => ({
        running: schedulerRunning ? 1 : 0
    }),
    topology: {
        role: 'service',
        cluster: 'services',
        zone: 'operations',
        upstreams: ['registry'],
        label: 'Firmware Scheduler',
        description: 'Auto-update scheduler',
        route: '/monitoring/services'
    }
});
