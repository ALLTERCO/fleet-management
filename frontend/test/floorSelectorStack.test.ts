import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import FloorSelectorStack from '@/components/locations/floorplan/FloorSelectorStack.vue';

const floors = [
    {id: 10, name: 'Basement', short: 'B1'},
    {id: 11, name: 'Ground', short: '0'},
    {id: 12, name: 'First', short: '1'},
    {id: 13, name: 'Second', short: '2'}
];

describe('FloorSelectorStack', () => {
    it('renders the top floor first so the stack reads top-down like building signage', () => {
        const wrapper = mount(FloorSelectorStack, {
            props: {floors, activeId: null}
        });
        const shorts = wrapper.findAll('.fss__short').map((n) => n.text());
        expect(shorts).toEqual(['2', '1', '0', 'B1']);
    });

    it('emits select with the floor id when a button is clicked', async () => {
        const wrapper = mount(FloorSelectorStack, {
            props: {floors, activeId: null}
        });
        await wrapper.findAll('.fss__btn').at(2)?.trigger('click');
        const event = wrapper.emitted('select');
        expect(event).toBeTruthy();
        expect(event?.[0]).toEqual([11]);
    });

    it('emits hover with the floor id on mouseenter and null on leave', async () => {
        const wrapper = mount(FloorSelectorStack, {
            props: {floors, activeId: null}
        });
        const second = wrapper.findAll('.fss__btn').at(1);
        await second?.trigger('mouseenter');
        await second?.trigger('mouseleave');
        const hovered = wrapper.emitted('hover');
        expect(hovered?.[0]).toEqual([12]);
        expect(hovered?.[1]).toEqual([null]);
    });

    it('marks the active id as pressed so screen readers and CSS can pick it up', () => {
        const wrapper = mount(FloorSelectorStack, {
            props: {floors, activeId: 12}
        });
        const active = wrapper
            .findAll('.fss__btn')
            .find((n) => n.attributes('aria-pressed') === 'true');
        expect(active?.text()).toContain('First');
    });

    it('renders nothing when no floors are passed so an empty building has no chrome', () => {
        const wrapper = mount(FloorSelectorStack, {
            props: {floors: [], activeId: null}
        });
        expect(wrapper.find('.fss').exists()).toBe(false);
    });
});
