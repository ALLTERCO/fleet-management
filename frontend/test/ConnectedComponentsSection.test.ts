import {flushPromises, mount} from '@vue/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {h} from 'vue';
import ConnectedComponentsSection from '@/components/devices/ConnectedComponentsSection.vue';
import type {entity_t} from '@/types';

const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({
    sendRPC,
    onDeviceRelationshipChanged: vi.fn(() => vi.fn())
}));

const graph = {
    center: 'device:vdev_hvac',
    nodes: [
        {id: 'device:vdev_hvac', type: 'device.virtual', label: 'Room HVAC'},
        {
            id: 'device:shelly_temp',
            type: 'device.physical',
            label: 'Bedroom Sensor'
        },
        {
            id: 'device:blu_gateway',
            type: 'device.physical',
            label: 'BLU Gateway'
        },
        {
            id: 'component:shelly_temp:temperature:0',
            type: 'component',
            label: 'Temperature'
        },
        {id: 'component:blu_trv:blutrv:0', type: 'component', label: 'TRV'}
    ],
    edges: [
        {
            id: 'temp-source',
            type: 'binds_role_to_source',
            source: 'role:vdev_hvac:current_temperature',
            target: 'component:shelly_temp:temperature:0',
            label: 'reads from'
        },
        {
            id: 'trv-gateway',
            type: 'transported_by_gateway',
            source: 'component:blu_trv:blutrv:0',
            target: 'device:blu_gateway',
            label: 'uses gateway'
        }
    ],
    summaries: [{severity: 'warning', text: 'Source is offline'}]
};

const virtualTemperature = {
    id: 'vdev_hvac:role:current_temperature:virtual',
    name: 'Current temperature',
    type: 'temperature',
    source: 'vdev_hvac',
    properties: {
        id: 0,
        roleKey: 'current_temperature',
        sourceDeviceExternalId: 'shelly_temp',
        sourceComponentKey: 'temperature:0',
        available: false
    }
} as entity_t;

const target = {
    id: 'vdev_hvac:role:target_temperature:virtual',
    name: 'Target temperature',
    type: 'number',
    source: 'vdev_hvac',
    properties: {
        id: 1,
        roleKey: 'target_temperature',
        sourceDeviceExternalId: 'blu_trv',
        sourceComponentKey: 'blutrv:0',
        available: true
    }
} as entity_t;

const energy = {
    id: 'vdev_hvac:role:power:virtual',
    name: 'Power',
    type: 'em',
    source: 'vdev_hvac',
    properties: {
        id: 2,
        roleKey: 'power',
        sourceDeviceExternalId: 'shelly_meter',
        sourceComponentKey: 'em:0',
        available: true
    }
} as entity_t;

function deferredGraph() {
    let resolve!: (value: typeof graph) => void;
    const promise = new Promise<typeof graph>((done) => {
        resolve = done;
    });
    return {promise, resolve};
}

beforeEach(() => {
    sendRPC.mockReset();
    sendRPC.mockResolvedValue(graph);
});

describe('ConnectedComponentsSection', () => {
    it('renders connected virtual and BLU components with operator-label chips', async () => {
        const wrapper = mount(ConnectedComponentsSection, {
            props: {
                shellyID: 'vdev_hvac',
                entities: [virtualTemperature, target, energy],
                groups: [
                    {
                        key: 'ble-aa',
                        type: 'ble',
                        icon: 'fab fa-bluetooth-b',
                        name: 'TRV channel',
                        productName: 'Shelly BLU TRV',
                        modelId: 'SBT',
                        sensors: []
                    }
                ],
                deviceOnline: true,
                deviceSleeping: false,
                relationshipContext: true
            },
            slots: {
                entity: ({entity}: {entity: entity_t}) =>
                    h('div', {class: 'fixture-card'}, entity.name),
                group: ({group}: {group: {name: string}}) =>
                    h('div', {class: 'fixture-group'}, group.name)
            }
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        // Flat list (no category sub-headers, no title, no health pills):
        // the components and their operator-label chips still render.
        expect(wrapper.text()).toContain('Current Temperature');
        expect(wrapper.text()).toContain('from Bedroom Sensor');
        expect(wrapper.text()).toContain('source offline');
        expect(wrapper.text()).toContain('TRV channel');
    });

    it('shows a clear empty state when no connected components are loaded', () => {
        const wrapper = mount(ConnectedComponentsSection, {
            props: {
                shellyID: 'vdev_empty',
                entities: [],
                groups: [],
                deviceOnline: true,
                deviceSleeping: false
            }
        });

        expect(wrapper.text()).toContain('No connected components');
    });

    it('does not load relationship context for ordinary device sections', () => {
        mount(ConnectedComponentsSection, {
            props: {
                shellyID: 'shelly_real',
                title: 'Entities',
                entities: [virtualTemperature],
                groups: [],
                deviceOnline: true,
                deviceSleeping: false,
                relationshipContext: false
            },
            slots: {
                entity: ({entity}: {entity: entity_t}) =>
                    h('div', {class: 'fixture-card'}, entity.name)
            }
        });

        expect(sendRPC).not.toHaveBeenCalled();
    });

    it('waits for relationship context before showing a healthy summary', () => {
        sendRPC.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(ConnectedComponentsSection, {
            props: {
                shellyID: 'vdev_pending',
                entities: [virtualTemperature],
                groups: [],
                deviceOnline: true,
                deviceSleeping: false,
                relationshipContext: true
            },
            slots: {
                entity: ({entity}: {entity: entity_t}) =>
                    h('div', {class: 'fixture-card'}, entity.name)
            }
        });

        expect(wrapper.text()).not.toContain('healthy');
    });

    it('keeps rendering components when relationship context fails', async () => {
        sendRPC.mockRejectedValue(new Error('network unavailable'));
        const wrapper = mount(ConnectedComponentsSection, {
            props: {
                shellyID: 'vdev_error',
                entities: [virtualTemperature],
                groups: [],
                deviceOnline: true,
                deviceSleeping: false,
                relationshipContext: true
            },
            slots: {
                entity: ({entity}: {entity: entity_t}) =>
                    h('div', {class: 'fixture-card'}, entity.name)
            }
        });

        await flushPromises();

        // Components still render even if relationship context fails.
        expect(wrapper.text()).toContain('Current temperature');
    });

    it('clears relationship errors when relationship context is disabled', async () => {
        sendRPC.mockRejectedValue(new Error('network unavailable'));
        const wrapper = mount(ConnectedComponentsSection, {
            props: {
                shellyID: 'vdev_error',
                entities: [virtualTemperature],
                groups: [],
                deviceOnline: true,
                deviceSleeping: false,
                relationshipContext: true
            },
            slots: {
                entity: ({entity}: {entity: entity_t}) =>
                    h('div', {class: 'fixture-card'}, entity.name)
            }
        });

        await flushPromises();
        await wrapper.setProps({relationshipContext: false});

        expect(wrapper.text()).not.toContain('relationship unavailable');
    });

    it('ignores stale relationship responses after the device changes', async () => {
        const first = deferredGraph();
        const second = deferredGraph();
        sendRPC
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const wrapper = mount(ConnectedComponentsSection, {
            props: {
                shellyID: 'vdev_first',
                entities: [virtualTemperature],
                groups: [],
                deviceOnline: true,
                deviceSleeping: false,
                relationshipContext: true
            },
            slots: {
                entity: ({entity}: {entity: entity_t}) =>
                    h('div', {class: 'fixture-card'}, entity.name)
            }
        });

        await wrapper.setProps({shellyID: 'vdev_second'});
        second.resolve({
            ...graph,
            nodes: graph.nodes.map((node) =>
                node.id === 'device:shelly_temp'
                    ? {...node, label: 'New Sensor'}
                    : node
            )
        });
        await flushPromises();
        first.resolve({
            ...graph,
            nodes: graph.nodes.map((node) =>
                node.id === 'device:shelly_temp'
                    ? {...node, label: 'Old Sensor'}
                    : node
            )
        });
        await flushPromises();

        expect(wrapper.text()).toContain('from New Sensor');
        expect(wrapper.text()).not.toContain('from Old Sensor');
    });
});
