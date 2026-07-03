import {flushPromises, mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, h} from 'vue';
import {useRafTime} from '@/composables/useRafTime';

const Probe = defineComponent({
    setup() {
        const {time} = useRafTime();
        return () => h('span', {'data-testid': 'time'}, String(time.value));
    }
});

describe('useRafTime', () => {
    let rafCallbacks: FrameRequestCallback[] = [];
    let nowMs = 1_000;

    beforeEach(() => {
        rafCallbacks = [];
        nowMs = 1_000;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    function flushFrame(advanceMs: number): void {
        nowMs += advanceMs;
        const next = rafCallbacks.shift();
        next?.(nowMs);
    }

    it('reports zero before any frame has fired', async () => {
        const wrapper = mount(Probe);
        await flushPromises();
        expect(wrapper.get('[data-testid="time"]').text()).toBe('0');
    });

    it('reflects the elapsed ms after each frame', async () => {
        const wrapper = mount(Probe);
        await flushPromises();
        flushFrame(0); // first frame seeds start
        await flushPromises();
        expect(wrapper.get('[data-testid="time"]').text()).toBe('0');
        flushFrame(150);
        await flushPromises();
        expect(wrapper.get('[data-testid="time"]').text()).toBe('150');
    });
});
