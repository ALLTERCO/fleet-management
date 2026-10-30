import {mount} from '@vue/test-utils';
import {defineComponent, h, nextTick, type Ref} from 'vue';
import {
    createMemoryHistory,
    createRouter,
    type Router
} from 'vue-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useUrlState} from '@/composables/useUrlState';

interface MountedState {
    router: Router;
    state: Record<string, Ref<string>>;
    unmount: () => void;
}

function moveHistory(router: Router, direction: 'back' | 'forward'): Promise<void> {
    return new Promise((resolve) => {
        const remove = router.afterEach(() => {
            remove();
            resolve();
        });
        router[direction]();
    });
}

async function mountState(initial: string): Promise<MountedState> {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{path: '/filters', component: {render: () => null}}]
    });
    await router.push(initial);
    await router.isReady();

    let state: Record<string, Ref<string>> | undefined;
    const Host = defineComponent({
        setup() {
            state = useUrlState('test-url-state', {
                search: '',
                group: ''
            });
            return () => h('div');
        }
    });
    const wrapper = mount(Host, {global: {plugins: [router]}});
    if (!state) throw new Error('useUrlState did not initialize');

    return {
        router,
        state,
        unmount: () => wrapper.unmount()
    };
}

describe('useUrlState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('follows query changes from navigation and restores defaults when keys disappear', async () => {
        const mounted = await mountState('/filters?search=first&group=1');

        await mounted.router.push('/filters?search=second&group=2');
        await nextTick();
        expect(mounted.state.search.value).toBe('second');
        expect(mounted.state.group.value).toBe('2');

        await mounted.router.push('/filters');
        await nextTick();
        expect(mounted.state.search.value).toBe('');
        expect(mounted.state.group.value).toBe('');

        await moveHistory(mounted.router, 'back');
        await nextTick();
        expect(mounted.state.search.value).toBe('second');
        expect(mounted.state.group.value).toBe('2');

        await moveHistory(mounted.router, 'back');
        await nextTick();
        expect(mounted.state.search.value).toBe('first');
        expect(mounted.state.group.value).toBe('1');

        await moveHistory(mounted.router, 'forward');
        await nextTick();
        expect(mounted.state.search.value).toBe('second');
        expect(mounted.state.group.value).toBe('2');

        mounted.unmount();
    });

    it('does not let a pending state write overwrite a newer history entry', async () => {
        vi.useFakeTimers();
        const mounted = await mountState('/filters?search=first');

        mounted.state.search.value = 'pending';
        await nextTick();
        await mounted.router.push('/filters?search=history');
        await nextTick();

        await vi.advanceTimersByTimeAsync(350);

        expect(mounted.state.search.value).toBe('history');
        expect(mounted.router.currentRoute.value.query.search).toBe('history');
        mounted.unmount();
    });

    it('ignores non-string persisted values instead of exposing them as string refs', async () => {
        localStorage.setItem(
            'test-url-state',
            JSON.stringify({search: {bad: true}, group: 12})
        );
        const mounted = await mountState('/filters');

        expect(mounted.state.search.value).toBe('');
        expect(mounted.state.group.value).toBe('');
        mounted.unmount();
    });
});
