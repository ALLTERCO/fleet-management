import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick, ref} from 'vue';

const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({
    sendRPC,
    connect: vi.fn(),
    close: vi.fn()
}));

vi.mock('@/stores/auth', () => ({
    useAuthStore: () => ({
        canWrite: true,
        isReadOnly: false,
        isAdmin: true,
        isViewer: false,
        permissionsLoaded: true,
        canPerformComponent: () => true
    })
}));

// Composable logic is covered in useWaitingRoomList.test.ts; mock the boundary.
const ctrl = vi.hoisted(() => ({
    devices: null as Record<string, unknown> | null,
    loadItems: vi.fn(),
    acceptDevice: vi.fn(),
    rejectDevice: vi.fn(),
    deviceClicked: vi.fn()
}));

vi.mock('@/composables/useWaitingRoomList', () => ({
    useWaitingRoomList: () => {
        const devices = ref(ctrl.devices);
        const entries = Object.entries(ctrl.devices ?? {});
        return {
            devices,
            loading: ref(false),
            error: ref(null),
            allEntries: ref(entries),
            paginatedItems: ref(entries),
            selected: ref<string[]>([]),
            selectedSet: ref(new Set<string>()),
            allSelected: ref(false),
            loadItems: ctrl.loadItems,
            refresh: vi.fn(),
            acceptDevice: ctrl.acceptDevice,
            rejectDevice: ctrl.rejectDevice,
            deviceClicked: ctrl.deviceClicked,
            toggleSelectAll: vi.fn(),
            clearSelection: vi.fn(),
            handleAccept: vi.fn(),
            handleReject: vi.fn(),
            openDetail: vi.fn()
        };
    }
}));

import RealSourceStep from '@/components/devices/add/RealSourceStep.vue';

const STUBS = {
    WaitingRoomBulkActions: {
        name: 'WaitingRoomBulkActions',
        template: '<div class="stub-bulk" />'
    },
    WaitingRoomDeviceCard: {
        name: 'WaitingRoomDeviceCard',
        props: ['device'],
        template:
            '<div class="stub-card" :data-id="device.shellyID" @click="$emit(\'accept\')" />'
    }
};

function mountStep() {
    return mount(RealSourceStep, {
        attachTo: document.body,
        global: {stubs: STUBS}
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
    sendRPC.mockReset();
    sendRPC.mockResolvedValue({});
    ctrl.devices = null;
    ctrl.loadItems.mockReset();
    ctrl.acceptDevice.mockReset();
    ctrl.rejectDevice.mockReset();
    ctrl.deviceClicked.mockReset();
});

describe('RealSourceStep — three discovery lanes are always visible', () => {
    it('renders Waiting / IP / Scan tabs so the user can see every option at once', () => {
        const w = mountStep();
        const tabs = w.findAll('[data-lane]');
        expect(tabs.map((t) => t.attributes('data-lane'))).toEqual([
            'waiting',
            'ip',
            'scan'
        ]);
        w.unmount();
    });

    it('defaults to the Waiting room lane so admin sees pending devices first', () => {
        const w = mountStep();
        expect(w.get('[data-lane="waiting"]').classes()).toContain(
            'rss__tab--active'
        );
        w.unmount();
    });
});

describe('RealSourceStep — waiting lane reuses the Waiting Room composable', () => {
    it('loads the pending list on mount via the shared composable', () => {
        mountStep();
        expect(ctrl.loadItems).toHaveBeenCalledOnce();
    });

    it('renders the shared bulk-action bar', () => {
        const w = mountStep();
        expect(w.find('.stub-bulk').exists()).toBe(true);
        w.unmount();
    });

    it('renders an explicit empty-state when no devices are waiting', () => {
        ctrl.devices = {};
        const w = mountStep();
        expect(w.text()).toContain('Nothing waiting');
        w.unmount();
    });

    it('renders one card per pending device and admits via the composable', async () => {
        ctrl.devices = {
            'wr-1': {shellyID: 'shellypro4pm-ccdd', addedAt: 100},
            'wr-2': {shellyID: 'shellyplus2pm-aabb', addedAt: 200}
        };
        const w = mountStep();
        const cards = w.findAll('.stub-card');
        expect(cards).toHaveLength(2);

        await cards[0].trigger('click');
        await nextTick();
        expect(ctrl.acceptDevice).toHaveBeenCalledWith('wr-1');
        w.unmount();
    });
});

describe('RealSourceStep — IP and Scan lanes render their controls', () => {
    it('switches to the IP lane and exposes a probe action', async () => {
        const w = mountStep();
        await w.get('[data-lane="ip"]').trigger('click');
        await nextTick();
        expect(w.text()).toMatch(/Probe device/);
        w.unmount();
    });

    it('switches to the Scan lane and surfaces the mDNS-disabled hint', async () => {
        const w = mountStep();
        await w.get('[data-lane="scan"]').trigger('click');
        await nextTick();
        expect(w.text()).toMatch(/mDNS is disabled/);
        w.unmount();
    });
});
