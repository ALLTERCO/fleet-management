import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import {h} from 'vue';
import FloorPlanEditDrawer from '@/components/locations/floorplan/FloorPlanEditDrawer.vue';

const sections = [
    {key: 'placements', label: 'Placements', icon: 'fa-thumbtack', badge: 3},
    {key: 'zones', label: 'Zones', icon: 'fa-draw-polygon', badge: 1},
    {key: 'fixtures', label: 'Fixtures', icon: 'fa-lightbulb', badge: null}
];

describe('FloorPlanEditDrawer', () => {
    it('only renders the slot for the open section so tools stay focused', () => {
        const wrapper = mount(FloorPlanEditDrawer, {
            props: {sections, openSection: 'zones'},
            slots: {
                placements: () => h('div', {class: 'p-slot'}, 'PLACEMENTS'),
                zones: () => h('div', {class: 'z-slot'}, 'ZONES'),
                fixtures: () => h('div', {class: 'f-slot'}, 'FIXTURES')
            }
        });
        expect(wrapper.find('.p-slot').exists()).toBe(false);
        expect(wrapper.find('.z-slot').exists()).toBe(true);
        expect(wrapper.find('.f-slot').exists()).toBe(false);
    });

    it('emits update:openSection when a different section header is clicked', async () => {
        const wrapper = mount(FloorPlanEditDrawer, {
            props: {sections, openSection: 'placements'}
        });
        await wrapper.findAll('.fpe__section-hdr').at(1)?.trigger('click');
        const event = wrapper.emitted('update:openSection');
        expect(event?.[0]).toEqual(['zones']);
    });

    it('collapses the open section to empty string when its own header is clicked again', async () => {
        const wrapper = mount(FloorPlanEditDrawer, {
            props: {sections, openSection: 'zones'}
        });
        await wrapper.findAll('.fpe__section-hdr').at(1)?.trigger('click');
        const event = wrapper.emitted('update:openSection');
        expect(event?.[0]).toEqual(['']);
    });

    it('renders badge count when provided and skips it when null', () => {
        const wrapper = mount(FloorPlanEditDrawer, {
            props: {sections, openSection: 'placements'}
        });
        const badges = wrapper
            .findAll('.fpe__section-badge')
            .map((n) => n.text());
        expect(badges).toEqual(['3', '1']);
    });

    it('emits close when the X button is clicked', async () => {
        const wrapper = mount(FloorPlanEditDrawer, {
            props: {sections, openSection: 'placements'}
        });
        await wrapper.find('.fpe__close').trigger('click');
        expect(wrapper.emitted('close')).toBeTruthy();
    });
});
