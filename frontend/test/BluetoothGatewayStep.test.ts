import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';

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
        permissionsLoaded: true
    })
}));

import BluetoothGatewayStep from '@/components/devices/add/BluetoothGatewayStep.vue';

beforeEach(() => {
    setActivePinia(createPinia());
    sendRPC.mockReset();
});

describe('BluetoothGatewayStep — loads BTHome-capable gateways on mount', () => {
    it('calls BTHome.ListGateways once when the step renders so the picker is ready', async () => {
        sendRPC.mockResolvedValue({items: []});
        const w = mount(BluetoothGatewayStep, {
            props: {modelValue: null},
            attachTo: document.body
        });
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'bthome.listgateways',
            {}
        );
        w.unmount();
    });

    it('renders the empty-state hint when no gateway is online — not a silent blank list', async () => {
        sendRPC.mockResolvedValue({items: []});
        const w = mount(BluetoothGatewayStep, {
            props: {modelValue: null},
            attachTo: document.body
        });
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        expect(w.text()).toContain('No BLU-capable gateway online');
        w.unmount();
    });

    it('renders one entry per gateway with name + Shelly ID visible', async () => {
        sendRPC.mockResolvedValue({
            items: [
                {shellyID: 'shellypro4pm-aabbccdd', name: 'Pro 4PM'},
                {shellyID: 'shellyplusplugs-eeff00', name: 'Plug S Gen3'}
            ]
        });
        const w = mount(BluetoothGatewayStep, {
            props: {modelValue: null},
            attachTo: document.body
        });
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        const items = w.findAll('.bgs__gateway');
        expect(items).toHaveLength(2);
        expect(items[0].text()).toContain('Pro 4PM');
        expect(items[0].text()).toContain('shellypro4pm-aabbccdd');
        w.unmount();
    });
});

describe('BluetoothGatewayStep — selecting a gateway emits the Shelly ID', () => {
    it('emits update:modelValue with the gateway shellyID on click', async () => {
        sendRPC.mockResolvedValue({
            items: [{shellyID: 'shellypro4pm-aabbccdd', name: 'Pro 4PM'}]
        });
        const w = mount(BluetoothGatewayStep, {
            props: {modelValue: null},
            attachTo: document.body
        });
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        await w.get('[data-gateway="shellypro4pm-aabbccdd"]').trigger('click');
        expect(w.emitted('update:modelValue')?.[0]).toEqual([
            'shellypro4pm-aabbccdd'
        ]);
        w.unmount();
    });

    it('highlights the currently chosen gateway so users see what is active', async () => {
        sendRPC.mockResolvedValue({
            items: [{shellyID: 'shellypro4pm-aabbccdd', name: 'Pro 4PM'}]
        });
        const w = mount(BluetoothGatewayStep, {
            props: {modelValue: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await nextTick();
        await new Promise((r) => setTimeout(r, 0));
        expect(
            w.get('[data-gateway="shellypro4pm-aabbccdd"]').classes()
        ).toContain('bgs__gateway--active');
        w.unmount();
    });
});

describe('BluetoothGatewayStep — surfaces RPC failures', () => {
    it('renders the error and a Retry button so the user can recover', async () => {
        sendRPC.mockRejectedValue(new Error('ws down'));
        const w = mount(BluetoothGatewayStep, {
            props: {modelValue: null},
            attachTo: document.body
        });
        await nextTick();
        await new Promise((r) => setTimeout(r, 10));
        await nextTick();
        expect(w.text()).toContain('ws down');
        expect(w.text()).toContain('Retry');
        w.unmount();
    });
});
