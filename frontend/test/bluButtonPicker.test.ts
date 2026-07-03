import {shallowMount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import BluButtonPicker from '@/components/core/BluButtonPicker.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import type {entity} from '@/types/entities';

function remote(id: number, name: string, labels: string[]): entity {
    return {
        name,
        id: `blu_${id}`,
        type: 'bthomedevice',
        source: 'gw',
        properties: {
            id,
            addr: 'AA:BB',
            productName: 'RC Button 4',
            modelId: 'SBRC-004CEU',
            paired: true,
            controls: labels.map((label, i) => ({
                objId: 58,
                idx: i,
                kind: 'button',
                label
            })),
            childSensorIds: [],
            eventObjIds: []
        }
    } as unknown as entity;
}

describe('BluButtonPicker', () => {
    it('emits a device_event config when a button + gesture are picked', async () => {
        const wrapper = shallowMount(BluButtonPicker, {
            props: {
                entities: [remote(200, 'Remote A', ['Button 1', 'Button 2'])],
                modelValue: {}
            }
        });
        const dropdowns = wrapper.findAllComponents(Dropdown);
        expect(dropdowns).toHaveLength(2);

        dropdowns[0].vm.$emit('selected', 'bthomedevice:200#1', 1);
        dropdowns[1].vm.$emit('selected', 'double_push', 1);
        await wrapper.vm.$nextTick();

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        expect(emitted!.at(-1)![0]).toEqual({
            componentType: 'bthomedevice',
            componentKey: 'bthomedevice:200',
            event: 'double_push',
            predicate: {idx: 1}
        });
    });

    it('renders nothing when the scoped device has no buttons', () => {
        const wrapper = shallowMount(BluButtonPicker, {
            props: {entities: [], modelValue: {}}
        });
        expect(wrapper.findAllComponents(Dropdown)).toHaveLength(0);
    });
});
