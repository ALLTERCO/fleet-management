import {mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, h} from 'vue';
import {
    __testing,
    type TimelinePlayback,
    useTimelinePlayback
} from '@/composables/useTimelinePlayback';

const {clampUnit, clampSpeed} = __testing;

describe('clampUnit', () => {
    it('forces non-finite inputs to zero', () => {
        expect(clampUnit(Number.NaN)).toBe(0);
        expect(clampUnit(Number.POSITIVE_INFINITY)).toBe(0);
    });
    it('clamps below zero to zero', () => {
        expect(clampUnit(-0.5)).toBe(0);
    });
    it('clamps above one to one', () => {
        expect(clampUnit(1.5)).toBe(1);
    });
    it('passes through values in range', () => {
        expect(clampUnit(0.42)).toBe(0.42);
    });
});

describe('clampSpeed', () => {
    it('falls back to 1 for non-positive or non-finite values', () => {
        expect(clampSpeed(0)).toBe(1);
        expect(clampSpeed(-3)).toBe(1);
        expect(clampSpeed(Number.NaN)).toBe(1);
    });
    it('passes through positive finite values', () => {
        expect(clampSpeed(4)).toBe(4);
    });
});

describe('useTimelinePlayback', () => {
    let rafCallbacks: FrameRequestCallback[] = [];
    let nowMs = 0;

    beforeEach(() => {
        rafCallbacks = [];
        nowMs = 1_000;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    });

    afterEach(() => vi.restoreAllMocks());

    function mountPlayback(
        durationMs: number,
        initialSpeed = 1
    ): TimelinePlayback {
        let captured: TimelinePlayback | null = null;
        const Host = defineComponent({
            setup() {
                captured = useTimelinePlayback({durationMs, initialSpeed});
                return () => h('div');
            }
        });
        mount(Host);
        if (!captured) throw new Error('Composable did not initialise');
        return captured;
    }

    function tickFrame(advanceMs: number): void {
        nowMs += advanceMs;
        const next = rafCallbacks.shift();
        next?.(nowMs);
    }

    it('starts paused at position zero', () => {
        const p = mountPlayback(10_000);
        expect(p.playing.value).toBe(false);
        expect(p.position.value).toBe(0);
    });

    it('advances the position proportional to elapsed time × speed when playing', () => {
        const p = mountPlayback(10_000, 1);
        p.play();
        tickFrame(2_500);
        expect(p.position.value).toBeCloseTo(0.25);
    });

    it('loops back to zero past the end of the duration', () => {
        const p = mountPlayback(1_000);
        p.play();
        tickFrame(1_500); // 1.5x duration
        expect(p.position.value).toBe(0);
    });

    it('seek snaps to the requested position and clamps out-of-range inputs', () => {
        const p = mountPlayback(1_000);
        p.seek(0.4);
        expect(p.position.value).toBe(0.4);
        p.seek(1.5);
        expect(p.position.value).toBe(1);
    });

    it('toggle alternates between play and pause', () => {
        const p = mountPlayback(1_000);
        p.toggle();
        expect(p.playing.value).toBe(true);
        p.toggle();
        expect(p.playing.value).toBe(false);
    });

    it('rate-limits invalid speed inputs to 1×', () => {
        const p = mountPlayback(1_000);
        p.setSpeed(-2);
        expect(p.speed.value).toBe(1);
        p.setSpeed(0);
        expect(p.speed.value).toBe(1);
    });
});
