import {mount} from '@vue/test-utils';
import {createPinia} from 'pinia';
import {describe, expect, it, vi} from 'vitest';
import DeviceRelationshipsPanel from '@/components/devices/DeviceRelationshipsPanel.vue';

const mocks = vi.hoisted(() => ({
    getDeviceGraph: vi.fn(async () => ({
        center: 'device:vdev_hvac',
        nodes: [
            {
                id: 'device:vdev_hvac',
                type: 'device.virtual',
                label: 'Room HVAC',
                status: 'online'
            },
            {
                id: 'device:thermostat',
                type: 'device.physical',
                label: 'Wall thermostat',
                status: 'online'
            },
            {
                id: 'dashboard:energy',
                type: 'dashboard',
                label: 'Energy dashboard',
                status: 'online'
            }
        ],
        edges: [
            {
                id: 'e-source',
                source: 'device:vdev_hvac',
                target: 'device:thermostat',
                type: 'binds_role_to_source',
                label: 'current temperature reads from',
                status: 'online'
            },
            {
                id: 'e-dashboard',
                source: 'device:vdev_hvac',
                target: 'dashboard:energy',
                type: 'shown_on_dashboard',
                label: 'shown on',
                status: 'online'
            }
        ],
        summaries: []
    }))
}));

vi.mock('@host/relationships', () => ({
    relationships: {getDeviceGraph: mocks.getDeviceGraph}
}));

vi.mock('@/tools/websocket', () => ({
    onDeviceRelationshipChanged: vi.fn(() => vi.fn())
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({push: vi.fn()})
}));

describe('DeviceRelationshipsPanel — virtual device grouping', () => {
    it('separates source bindings from ordinary connections', async () => {
        const wrapper = mount(DeviceRelationshipsPanel, {
            props: {shellyID: 'vdev_hvac'},
            global: {
                plugins: [createPinia()],
                stubs: {
                    DeviceTopology: true,
                    Notification: {
                        template: '<div><slot /></div>'
                    },
                    Spinner: true
                }
            }
        });

        await vi.waitFor(() => {
            expect(wrapper.text()).toContain('Reads from');
        });

        expect(wrapper.text()).toContain('Wall thermostat');
        expect(wrapper.text()).toContain('All connections');
        expect(wrapper.text()).toContain('Watched & shown');
        expect(wrapper.text()).toContain('Energy dashboard');
    });
});
