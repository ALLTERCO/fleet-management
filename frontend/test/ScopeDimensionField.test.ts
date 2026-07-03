import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import ScopeDimensionField from '@/components/core/ScopeDimensionField.vue';
import {SCOPE_DIMENSIONS} from '@/helpers/scopeDimensions';

const DEVICES_DIM = SCOPE_DIMENSIONS.find((d) => d.key === 'device_ids');
if (!DEVICES_DIM) throw new Error('device_ids dimension missing');

const OPTIONS = [
    {value: 'd1', label: 'Boiler'},
    {value: 'd2', label: 'Garage door'}
];

function mountField(modelValue: Array<string | number>) {
    return mount(ScopeDimensionField, {
        props: {dim: DEVICES_DIM, options: OPTIONS, modelValue},
        global: {stubs: {Dropdown: true}}
    });
}

describe('ScopeDimensionField', () => {
    it('shows picked items as named chips with a count', () => {
        const wrapper = mountField(['d1']);
        expect(wrapper.text()).toContain('Boiler');
        expect(wrapper.text()).toContain('1');
        wrapper.unmount();
    });

    it('appends on add and ignores duplicates', async () => {
        const wrapper = mountField(['d1']);
        const dropdown = wrapper.findComponent({name: 'Dropdown'});
        dropdown.vm.$emit('selected', 'd2');
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
            ['d1', 'd2']
        ]);
        dropdown.vm.$emit('selected', 'd1');
        await wrapper.vm.$nextTick();
        // Duplicate add emits nothing new.
        expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
        wrapper.unmount();
    });

    it('removes a chip via its remove button', async () => {
        const wrapper = mountField(['d1', 'd2']);
        await wrapper.find('button[title="Remove Boiler"]').trigger('click');
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['d2']]);
        wrapper.unmount();
    });

    it('explains an empty source list instead of a dead dropdown', () => {
        const wrapper = mount(ScopeDimensionField, {
            props: {dim: DEVICES_DIM, options: [], modelValue: []},
            global: {stubs: {Dropdown: true}}
        });
        expect(wrapper.text()).toContain('No devices exist yet');
        expect(wrapper.findComponent({name: 'Dropdown'}).exists()).toBe(false);
        wrapper.unmount();
    });

    it('hides the add dropdown once everything is picked', () => {
        const wrapper = mountField(['d1', 'd2']);
        expect(wrapper.findComponent({name: 'Dropdown'}).exists()).toBe(false);
        wrapper.unmount();
    });

    it('offers only not-yet-picked options in the add dropdown', () => {
        const wrapper = mountField(['d1']);
        const groups = wrapper
            .findComponent({name: 'Dropdown'})
            .props('groups');
        expect(groups[0].items).toEqual([{value: 'd2', label: 'Garage door'}]);
        wrapper.unmount();
    });
});
