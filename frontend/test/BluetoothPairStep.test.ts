import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    connect: vi.fn(),
    close: vi.fn()
}));

vi.mock('@/stores/devices', () => ({
    useDevicesStore: () => ({devices: [], byId: () => null})
}));

vi.mock('@/stores/entities', () => ({
    useEntityStore: () => ({entities: []})
}));

import BluetoothPairStep from '@/components/devices/add/BluetoothPairStep.vue';

describe('BluetoothPairStep — guards on a missing gateway', () => {
    it('shows the "pick a gateway first" hint when no gateway is selected — prevents pair UI boot with empty ID', () => {
        const w = mount(BluetoothPairStep, {
            props: {gatewayId: null},
            attachTo: document.body,
            global: {
                stubs: {
                    BtHomeConfig: {
                        template: '<div data-stub="bthome" />'
                    }
                }
            }
        });
        expect(w.text()).toContain('Pick a gateway in the previous step');
        expect(w.find('[data-stub="bthome"]').exists()).toBe(false);
        w.unmount();
    });

    it('mounts the BLU config panel with the selected gateway when one is provided', () => {
        const w = mount(BluetoothPairStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body,
            global: {
                stubs: {
                    BtHomeConfig: {
                        name: 'BtHomeConfig',
                        props: ['shellyID'],
                        template:
                            '<div data-stub="bthome" :data-shelly="shellyID" />'
                    }
                }
            }
        });
        const stub = w.find('[data-stub="bthome"]');
        expect(stub.exists()).toBe(true);
        expect(stub.attributes('data-shelly')).toBe('shellypro4pm-aabbccdd');
        w.unmount();
    });
});
