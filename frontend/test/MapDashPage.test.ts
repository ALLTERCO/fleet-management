// Page-level tests for /dash/map/[id].vue. WorldMap stubbed without `emits`
// so @pin-click stays in ctx.attrs and can be invoked directly.

import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, h, nextTick} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';

// ---- sendRPC mock (hoisted) -------------------------------------------------

const {sendRPC} = vi.hoisted(() => ({sendRPC: vi.fn()}));

vi.mock('@/tools/websocket', () => ({
    sendRPC,
    close: () => {},
    onLocationEvent: () => () => undefined,
    onAlertEvent: () => () => undefined,
    onAlertInstanceEvent: () => () => undefined,
    onDeviceEvent: () => () => undefined
}));
vi.mock('@/tools/observability', () => ({trackInteraction: vi.fn()}));
vi.mock('@/stores/toast', () => ({useToastStore: () => ({error: vi.fn()})}));

// ---- imports ----------------------------------------------------------------

import MapDashPage from '@/pages/dash/map/[id].vue';
import type {ApiLocation} from '@/stores/locations';

// ---- helpers ----------------------------------------------------------------

function makeLocation(id: number): ApiLocation {
    return {
        id,
        organizationId: 'org',
        name: `Site ${id}`,
        kind: 'site',
        parentLocationId: null,
        sortOrder: 0,
        kindFields: {geo: {lat: 52.52, lng: 13.41}},
        customFields: {},
        effective: {
            timezone: null,
            countryCode: null,
            currency: null,
            regulatoryZone: null,
            complianceTags: []
        },
        coordinateStatus: {state: 'missing_address', summary: ''},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null
    };
}

const flyToCalls: Array<[number, number]> = [];

// WorldMap stub: no `emits` declaration so the parent's onPinClick / onPinHover
// stay in ctx.attrs and the stub can invoke them directly.
const WorldMapStub = defineComponent({
    name: 'WorldMap',
    inheritAttrs: false,
    setup(_props: unknown, ctx: any) {
        ctx.expose({
            project: (_lngLat: [number, number]) => ({x: 200, y: 300}),
            onMapMove: (_cb: () => void) => () => {},
            flyTo: (lng: number, lat: number) => flyToCalls.push([lng, lat])
        });
        return () => h('div', {'data-testid': 'world-map-stub'});
    }
});

const PAGE_STUBS = {WorldMap: WorldMapStub};

function makeRouter() {
    return createRouter({
        history: createMemoryHistory(),
        routes: [{path: '/dash/map/:id', component: {template: '<div />'}}]
    });
}

async function mountPage(router: ReturnType<typeof makeRouter>) {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(MapDashPage, {
        global: {
            plugins: [pinia, router],
            stubs: PAGE_STUBS
        }
    });
    await nextTick();
    await nextTick();
    return wrapper;
}

async function triggerPinClick(
    wrapper: ReturnType<typeof mount>,
    id: string | number
): Promise<void> {
    const mapWrapper = wrapper.findComponent(WorldMapStub);
    const handler = (mapWrapper.vm.$attrs as Record<string, unknown>)
        .onPinClick as ((pin: {id: string | number}) => void) | undefined;
    handler?.({id});
    await nextTick();
}

async function triggerPinHover(
    wrapper: ReturnType<typeof mount>,
    pin: {id: string; lat: number; lng: number; label?: string} | null
): Promise<void> {
    const mapWrapper = wrapper.findComponent(WorldMapStub);
    const handler = (mapWrapper.vm.$attrs as Record<string, unknown>)
        .onPinHover as ((pin: object | null) => void) | undefined;
    handler?.(pin);
    await nextTick();
}

// ---- tests ------------------------------------------------------------------

describe('MapDashPage', () => {
    beforeEach(() => {
        flyToCalls.length = 0;
        sendRPC.mockReset();
        sendRPC.mockImplementation((_ns: string, method: string) => {
            if (method === 'location.list') {
                return {items: [makeLocation(7)], has_more: false};
            }
            if (method === 'location.listkind') {
                return {kinds: []};
            }
            // Storage.GetItem for dashboard record — return empty.
            return undefined;
        });
    });

    afterEach(() => {
        sendRPC.mockReset();
    });

    it('renders the map and the fleet pulse strip', async () => {
        const router = makeRouter();
        await router.push('/dash/map/1');
        const wrapper = await mountPage(router);

        expect(wrapper.findComponent({name: 'WorldMap'}).exists()).toBe(true);
        expect(wrapper.findComponent({name: 'MapPulseStrip'}).exists()).toBe(
            true
        );
    });

    it('opens the focus card when a map pin is clicked', async () => {
        const router = makeRouter();
        await router.push('/dash/map/1');
        const wrapper = await mountPage(router);

        // Card is absent before any click.
        expect(
            wrapper.findComponent({name: 'LocationFocusCard'}).exists()
        ).toBe(false);

        await triggerPinClick(wrapper, '7');

        expect(
            wrapper.findComponent({name: 'LocationFocusCard'}).exists()
        ).toBe(true);
    });

    it('flies the map to the clicked pin lng/lat', async () => {
        const router = makeRouter();
        await router.push('/dash/map/1');
        const wrapper = await mountPage(router);

        await triggerPinClick(wrapper, '7');

        expect(flyToCalls).toHaveLength(1);
        expect(flyToCalls[0]).toEqual([13.41, 52.52]);
    });

    it('shows the pin tooltip 150 ms after hover and clears it on hover-out', async () => {
        vi.useFakeTimers();
        try {
            const router = makeRouter();
            await router.push('/dash/map/1');
            const wrapper = await mountPage(router);

            await triggerPinHover(wrapper, {
                id: '7',
                lat: 52.52,
                lng: 13.41,
                label: 'Berlin HQ'
            });
            // Tooltip absent until the hover delay elapses.
            expect(wrapper.find('.pin-tip').exists()).toBe(false);

            vi.advanceTimersByTime(160);
            await nextTick();

            const tip = wrapper.find('.pin-tip');
            expect(tip.exists()).toBe(true);
            expect(tip.text()).toContain('Berlin HQ');

            await triggerPinHover(wrapper, null);
            await nextTick();
            expect(wrapper.find('.pin-tip').exists()).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('closes the focus card when Escape is pressed', async () => {
        const router = makeRouter();
        await router.push('/dash/map/1');
        const wrapper = await mountPage(router);

        await triggerPinClick(wrapper, '7');
        expect(
            wrapper.findComponent({name: 'LocationFocusCard'}).exists()
        ).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
        await nextTick();

        expect(
            wrapper.findComponent({name: 'LocationFocusCard'}).exists()
        ).toBe(false);
    });
});
