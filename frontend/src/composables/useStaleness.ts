import {computed, onBeforeUnmount, onMounted, type Ref, ref} from 'vue';

export type StalenessLevel = 'fresh' | 'warn' | 'stale';

export interface StalenessThresholds {
    /** Expected refresh cadence in ms — drives the 2x / 5x band split. */
    expectedIntervalMs: number;
}

export interface StalenessSnapshot {
    ageMs: number;
    level: StalenessLevel;
    label: string;
}

const WARN_FACTOR = 2;
const STALE_FACTOR = 5;
const TICK_MS = 1000;

function levelFor(ageMs: number, expected: number): StalenessLevel {
    if (ageMs < expected * WARN_FACTOR) return 'fresh';
    if (ageMs < expected * STALE_FACTOR) return 'warn';
    return 'stale';
}

function labelFor(ageMs: number): string {
    if (ageMs < 5_000) return 'just now';
    const seconds = Math.floor(ageMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

function snapshot(ageMs: number, expected: number): StalenessSnapshot {
    return {
        ageMs,
        level: levelFor(ageMs, expected),
        label: labelFor(ageMs)
    };
}

export const __testing = {levelFor, labelFor, snapshot};

// Reactive staleness — recomputes once per second, cheap enough for any badge.
export function useStaleness(
    lastSeenMs: Ref<number | null | undefined>,
    thresholds: StalenessThresholds
): Ref<StalenessSnapshot | null> {
    const now = ref(Date.now());
    let intervalId: ReturnType<typeof setInterval> | null = null;

    onMounted(() => {
        intervalId = setInterval(() => {
            now.value = Date.now();
        }, TICK_MS);
    });
    onBeforeUnmount(() => {
        if (intervalId !== null) clearInterval(intervalId);
    });

    return computed(() => {
        const stamp = lastSeenMs.value;
        // 0 is the "unknown" sentinel in LocationKpiSnapshot — treat as null.
        if (stamp == null || stamp === 0) return null;
        const ageMs = Math.max(0, now.value - stamp);
        return snapshot(ageMs, thresholds.expectedIntervalMs);
    });
}
