/** Behavioural tests for the useLocationFocusCard composable.
 *  Targets specifically: snooze rejection path keeps the card open and
 *  surfaces a toast (regression for the silent-swallow bug). */

import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, h, nextTick, ref} from 'vue';
import type {RouteLocationNormalizedLoaded, Router} from 'vue-router';

import type {ApiLocation} from '@/stores/locations';

const toastError = vi.fn();
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));

vi.mock('@/tools/observability', () => ({trackInteraction: vi.fn()}));

vi.mock('@/helpers/realtimeSocket', () => ({
    realtimeSocket: {isWired: false, subscribe: () => () => {}}
}));

import {mount} from '@vue/test-utils';
import {
    type MapPinProjector,
    useLocationFocusCard
} from '@/composables/useLocationFocusCard';
import {useLocationsStore} from '@/stores/locations';

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

function makeRouterStub(): Router {
    const query: Record<string, string> = {};
    return {
        replace: vi.fn(async (loc: {query?: Record<string, string>}) => {
            Object.assign(query, loc.query ?? {});
        }),
        push: vi.fn(async () => {})
    } as unknown as Router;
}

function makeRouteStub(): RouteLocationNormalizedLoaded {
    return {
        path: '/organize/locations',
        query: {},
        params: {}
    } as unknown as RouteLocationNormalizedLoaded;
}

function mountWithComposable(input: {
    snoozeLocation?: (id: number) => Promise<void>;
    onOpenSite?: (id: number) => Promise<void> | void;
    flyTo?: (lng: number, lat: number) => void;
    handleEscape?: boolean;
}) {
    const worldMapRef = ref<MapPinProjector | null>({
        project: () => ({x: 100, y: 100}),
        onMapMove: () => () => {},
        flyTo: input.flyTo
    });

    let composable: ReturnType<typeof useLocationFocusCard> | null = null;

    const Host = defineComponent({
        setup() {
            composable = useLocationFocusCard({
                worldMapRef,
                route: makeRouteStub(),
                router: makeRouterStub(),
                config: {
                    telemetryScope: 'test',
                    onOpenSite: input.onOpenSite ?? (async () => {}),
                    onOpenFloorPlan: async () => {},
                    snoozeLocation: input.snoozeLocation,
                    handleEscape: input.handleEscape
                }
            });
            return () => h('div');
        }
    });

    const wrapper = mount(Host);
    return {wrapper, getComposable: () => composable};
}

describe('useLocationFocusCard snooze flow', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        toastError.mockClear();

        const store = useLocationsStore();
        store.locations[7] = makeLocation(7);
    });

    it('keeps the card open and surfaces a toast when snoozeLocation rejects', async () => {
        const rejectingStub = vi.fn(async () => {
            throw new Error('backend down');
        });

        const {getComposable} = mountWithComposable({
            snoozeLocation: rejectingStub
        });
        const c = getComposable();
        expect(c).not.toBeNull();
        if (!c) return;

        await c.onPinClick({id: 7});
        await nextTick();
        expect(c.focusedSite.value).not.toBeNull();

        await c.onCardSnooze();
        await nextTick();

        // Snooze stub was called once
        expect(rejectingStub).toHaveBeenCalledWith(7);

        // Card is STILL open — user can retry
        expect(c.focusedSite.value).not.toBeNull();

        // Pending flag is cleared so the user can click again
        expect(c.snoozePending.value).toBe(false);

        // Toast.error was invoked with a user-facing message
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(toastError.mock.calls[0][0]).toMatch(/snooze failed/i);
    });

    it('closes the card on successful snooze', async () => {
        const resolvingStub = vi.fn(async () => {
            // Resolves immediately
        });

        const {getComposable} = mountWithComposable({
            snoozeLocation: resolvingStub
        });
        const c = getComposable();
        if (!c) return;

        await c.onPinClick({id: 7});
        await nextTick();
        expect(c.focusedSite.value).not.toBeNull();

        await c.onCardSnooze();
        await nextTick();

        expect(resolvingStub).toHaveBeenCalledWith(7);
        expect(c.focusedSite.value).toBeNull(); // closed
        expect(toastError).not.toHaveBeenCalled();
    });

    it('reports snoozeAvailable=false when no snoozeLocation is wired', () => {
        const {getComposable} = mountWithComposable({});
        const c = getComposable();
        expect(c?.snoozeAvailable).toBe(false);
    });

    it('reports snoozeAvailable=true when a snoozeLocation callback is wired', () => {
        const {getComposable} = mountWithComposable({
            snoozeLocation: async () => {}
        });
        const c = getComposable();
        expect(c?.snoozeAvailable).toBe(true);
    });

    it('does nothing on Snooze click when snoozeLocation is omitted', async () => {
        const {getComposable} = mountWithComposable({});
        const c = getComposable();
        if (!c) return;

        await c.onPinClick({id: 7});
        await nextTick();

        await c.onCardSnooze();
        await nextTick();

        expect(c.focusedSite.value).not.toBeNull();
        expect(toastError).not.toHaveBeenCalled();
    });
});

describe('useLocationFocusCard navigation failure', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        toastError.mockClear();
        const store = useLocationsStore();
        store.locations[7] = makeLocation(7);
    });

    it('keeps the card open and surfaces a toast when onOpenSite rejects', async () => {
        const rejecting = vi.fn(async () => {
            throw new Error('route guard aborted');
        });

        const {getComposable} = mountWithComposable({
            onOpenSite: rejecting
        });
        const c = getComposable();
        if (!c) return;

        await c.onPinClick({id: 7});
        await nextTick();
        expect(c.focusedSite.value).not.toBeNull();

        await c.onCardOpenSite();
        await nextTick();

        expect(rejecting).toHaveBeenCalled();
        // Card stays open so the user can retry / close manually
        expect(c.focusedSite.value).not.toBeNull();
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(toastError.mock.calls[0][0]).toMatch(/navigation failed/i);
    });
});

describe('useLocationFocusCard camera flyTo', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        const store = useLocationsStore();
        store.locations[7] = makeLocation(7);
    });

    it('flies the map to the clicked pin lng/lat when the world map exposes flyTo', async () => {
        const flyTo = vi.fn();
        const {getComposable} = mountWithComposable({flyTo});
        const c = getComposable();
        if (!c) return;

        await c.onPinClick({id: 7});
        await nextTick();

        expect(flyTo).toHaveBeenCalledTimes(1);
        expect(flyTo).toHaveBeenCalledWith(13.41, 52.52);
    });

    it('does not throw when the world map predates the flyTo expose', async () => {
        const {getComposable} = mountWithComposable({});
        const c = getComposable();
        if (!c) return;

        await expect(c.onPinClick({id: 7})).resolves.toBeUndefined();
        expect(c.focusedSite.value).not.toBeNull();
    });
});

describe('useLocationFocusCard Escape handling ownership', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        const store = useLocationsStore();
        store.locations[7] = makeLocation(7);
    });

    it('closes the focus card on Esc by default (Locations page contract)', async () => {
        const {getComposable} = mountWithComposable({});
        const c = getComposable();
        if (!c) return;

        await c.onPinClick({id: 7});
        await nextTick();
        expect(c.focusedSite.value).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
        await nextTick();
        expect(c.focusedSite.value).toBeNull();
    });

    it('leaves the focus card open when handleEscape is false (host owns cascade)', async () => {
        const {getComposable} = mountWithComposable({handleEscape: false});
        const c = getComposable();
        if (!c) return;

        await c.onPinClick({id: 7});
        await nextTick();
        expect(c.focusedSite.value).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
        await nextTick();
        expect(c.focusedSite.value).not.toBeNull();
    });
});
