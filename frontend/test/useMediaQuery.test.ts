import {flushPromises, mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, h} from 'vue';
import {useMediaQuery} from '@/composables/useMediaQuery';

interface ListenerEntry {
    type: string;
    listener: (event: MediaQueryListEvent) => void;
}

function createMql(matches: boolean) {
    const listeners: ListenerEntry[] = [];
    const mql = {
        matches,
        media: '',
        addEventListener: (type: string, l: ListenerEntry['listener']) =>
            listeners.push({type, listener: l}),
        removeEventListener: (type: string, l: ListenerEntry['listener']) => {
            const idx = listeners.findIndex(
                (e) => e.type === type && e.listener === l
            );
            if (idx !== -1) listeners.splice(idx, 1);
        }
    } as unknown as MediaQueryList;
    return {mql, listeners};
}

const Probe = defineComponent({
    setup() {
        const m = useMediaQuery('(max-width: 640px)');
        return () => h('span', {'data-testid': 'match'}, String(m.value));
    }
});

describe('useMediaQuery', () => {
    let listeners: ListenerEntry[] = [];

    beforeEach(() => {
        const created = createMql(true);
        listeners = created.listeners;
        vi.spyOn(window, 'matchMedia').mockImplementation(() => created.mql);
    });

    afterEach(() => vi.restoreAllMocks());

    it('reports the initial matchMedia state on mount', async () => {
        const w = mount(Probe);
        await flushPromises();
        expect(w.text()).toBe('true');
    });

    it('subscribes a single change listener while mounted', async () => {
        mount(Probe);
        await flushPromises();
        expect(listeners).toHaveLength(1);
    });
});
