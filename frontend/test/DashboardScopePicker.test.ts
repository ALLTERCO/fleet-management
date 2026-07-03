// Component: DashboardScopePicker — verifies the trigger label tracks the
// selected scope, the menu groups Groups + Tags, and change events fire
// with the correct payload.

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import DashboardScopePicker from '@/components/dashboard/DashboardScopePicker.vue';

const GROUPS = [
    {id: 1, name: 'Office'},
    {id: 2, name: 'Warehouse'}
];
const TAGS = [{id: 9, name: 'HVAC'}];

describe('DashboardScopePicker', () => {
    it('shows "Fleet" when scope kind is fleet', () => {
        const wrapper = mount(DashboardScopePicker, {
            props: {scope: {kind: 'fleet'}, groups: GROUPS, tags: TAGS}
        });
        expect(wrapper.find('.dsp__label').text()).toBe('Fleet');
    });

    it('shows the group name when scope kind is group', () => {
        const wrapper = mount(DashboardScopePicker, {
            props: {
                scope: {kind: 'group', id: 2},
                groups: GROUPS,
                tags: TAGS
            }
        });
        expect(wrapper.find('.dsp__label').text()).toBe('Warehouse');
    });

    it('shows the tag name when scope kind is tag', () => {
        const wrapper = mount(DashboardScopePicker, {
            props: {scope: {kind: 'tag', id: 9}, groups: GROUPS, tags: TAGS}
        });
        expect(wrapper.find('.dsp__label').text()).toBe('HVAC');
    });

    it('renders a fallback label when the id is missing from the list', () => {
        const wrapper = mount(DashboardScopePicker, {
            props: {scope: {kind: 'group', id: 99}, groups: GROUPS, tags: TAGS}
        });
        expect(wrapper.find('.dsp__label').text()).toBe('Group 99');
    });

    it('applies the scoped class when not on fleet', () => {
        const wrapper = mount(DashboardScopePicker, {
            props: {scope: {kind: 'group', id: 1}, groups: GROUPS, tags: TAGS}
        });
        expect(wrapper.find('.dsp__trigger').classes()).toContain(
            'dsp__trigger--scoped'
        );
    });

    it('opens the menu on trigger click and emits change for the picked option', async () => {
        const wrapper = mount(DashboardScopePicker, {
            props: {scope: {kind: 'fleet'}, groups: GROUPS, tags: TAGS}
        });
        await wrapper.find('.dsp__trigger').trigger('click');
        await nextTick();
        expect(wrapper.find('.dsp__menu').exists()).toBe(true);

        const officeItem = wrapper
            .findAll('.dsp__item')
            .find((b) => b.text().includes('Office'));
        await officeItem?.trigger('click');
        const emitted = wrapper.emitted('change');
        expect(emitted?.[0]).toEqual([{kind: 'group', id: 1}]);
    });
});
