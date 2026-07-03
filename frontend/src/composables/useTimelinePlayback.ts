import {onBeforeUnmount, type Ref, ref} from 'vue';

export interface TimelinePlaybackOptions {
    durationMs: number;
    /** Default speed multiplier — 1 = real time, 60 = 1 minute per second. */
    initialSpeed?: number;
    initialPosition?: number;
}

export interface TimelinePlayback {
    readonly position: Ref<number>;
    readonly playing: Ref<boolean>;
    readonly speed: Ref<number>;
    play(): void;
    pause(): void;
    toggle(): void;
    seek(target: number): void;
    setSpeed(next: number): void;
}

const VALID_SPEEDS = [1, 2, 4, 8, 16, 60] as const;

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function clampSpeed(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return value;
}

export const __testing = {clampUnit, clampSpeed, VALID_SPEEDS};

// Drives a 0..1 position ref at `speed × realTime`. Owners pass durationMs;
// playback wraps to 0 at the end so it loops naturally.
export function useTimelinePlayback(
    options: TimelinePlaybackOptions
): TimelinePlayback {
    const duration = Math.max(1, options.durationMs);
    const position = ref(clampUnit(options.initialPosition ?? 0));
    const playing = ref(false);
    const speed = ref(clampSpeed(options.initialSpeed ?? 1));

    let rafId: number | null = null;
    let lastTick = 0;

    onBeforeUnmount(stopLoop);

    return {
        position,
        playing,
        speed,
        play,
        pause,
        toggle,
        seek,
        setSpeed
    };

    function play(): void {
        if (playing.value) return;
        playing.value = true;
        lastTick = performance.now();
        rafId = requestAnimationFrame(step);
    }

    function pause(): void {
        if (!playing.value) return;
        playing.value = false;
        stopLoop();
    }

    function toggle(): void {
        if (playing.value) pause();
        else play();
    }

    function seek(target: number): void {
        position.value = clampUnit(target);
    }

    function setSpeed(next: number): void {
        speed.value = clampSpeed(next);
    }

    function stopLoop(): void {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
    }

    function step(now: number): void {
        if (!playing.value) return;
        const elapsed = now - lastTick;
        lastTick = now;
        const advance = (elapsed * speed.value) / duration;
        const next = position.value + advance;
        position.value = next >= 1 ? 0 : next;
        rafId = requestAnimationFrame(step);
    }
}
