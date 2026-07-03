import {flushPromises, mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import TweenNumber from '@/components/core/TweenNumber.vue';

describe('TweenNumber', () => {
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

    function flushFrame(advanceMs: number): void {
        nowMs += advanceMs;
        const next = rafCallbacks.shift();
        next?.(nowMs);
    }

    it('renders the initial value as an integer by default', () => {
        const w = mount(TweenNumber, {props: {value: 42}});
        expect(w.text()).toBe('42');
    });

    it('respects the decimals prop', () => {
        const w = mount(TweenNumber, {props: {value: 1.234, decimals: 2}});
        expect(w.text()).toBe('1.23');
    });

    it('clamps non-finite incoming values to zero', () => {
        const w = mount(TweenNumber, {props: {value: Number.NaN}});
        expect(w.text()).toBe('0');
    });

    it('lands exactly on the target value when the animation completes', async () => {
        const w = mount(TweenNumber, {props: {value: 0, durationMs: 100}});
        await w.setProps({value: 10});
        await flushPromises();
        flushFrame(100); // jump straight to end of cycle
        await flushPromises();
        expect(w.text()).toBe('10');
    });

    it('marks itself aria-live polite so assistive tech announces updates', () => {
        const w = mount(TweenNumber, {props: {value: 1}});
        expect(w.attributes('aria-live')).toBe('polite');
    });
});
