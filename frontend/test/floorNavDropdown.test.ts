/** Behavioural tests for FloorNavDropdown. One rule per test. */

import {mount} from '@vue/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import FloorNavDropdown, {
    type FloorNavSection
} from '@/components/locations/floorplan/FloorNavDropdown.vue';

const sections: FloorNavSection[] = [
    {
        title: 'Zones',
        icon: 'fa-draw-polygon',
        items: [
            {id: 'lobby', kind: 'zone', label: 'Lobby', colorDot: '#abc'},
            {id: 'office', kind: 'zone', label: 'Office', colorDot: '#def'}
        ]
    },
    {
        title: 'Devices on this floor',
        icon: 'fa-plug',
        items: [
            {
                id: 'dev-1',
                kind: 'device',
                label: 'Shelly Plus 1',
                colorDot: '#123'
            }
        ]
    }
];

function mountDropdown(
    overrides: Partial<{
        activeId: number | string | null;
        activeKind: 'floor' | 'zone' | 'device' | null;
    }> = {}
) {
    return mount(FloorNavDropdown, {
        props: {
            sections,
            activeId: overrides.activeId ?? null,
            activeKind: overrides.activeKind ?? null,
            triggerLabel: 'On this floor',
            triggerIcon: 'fa-compass'
        },
        attachTo: document.body
    });
}

describe('FloorNavDropdown', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('renders the trigger label closed by default', () => {
        const wrapper = mountDropdown();
        expect(wrapper.find('.fnd__trigger-label').text()).toBe(
            'On this floor'
        );
        expect(wrapper.find('.fnd__panel').exists()).toBe(false);
        wrapper.unmount();
    });

    it('opens the panel when the trigger is clicked', async () => {
        const wrapper = mountDropdown();
        await wrapper.find('.fnd__trigger').trigger('click');
        expect(wrapper.find('.fnd__panel').exists()).toBe(true);
        wrapper.unmount();
    });

    it('renders one section per provided FloorNavSection', async () => {
        const wrapper = mountDropdown();
        await wrapper.find('.fnd__trigger').trigger('click');
        expect(wrapper.findAll('.fnd__section')).toHaveLength(2);
        wrapper.unmount();
    });

    it('renders one item per node in each section', async () => {
        const wrapper = mountDropdown();
        await wrapper.find('.fnd__trigger').trigger('click');
        const labels = wrapper.findAll('.fnd__item-label').map((n) => n.text());
        expect(labels).toEqual(['Lobby', 'Office', 'Shelly Plus 1']);
        wrapper.unmount();
    });

    it('emits select with the clicked item and closes the panel', async () => {
        const wrapper = mountDropdown();
        await wrapper.find('.fnd__trigger').trigger('click');
        const second = wrapper.findAll('.fnd__item').at(1);
        await second?.trigger('click');
        const emitted = wrapper.emitted('select');
        expect(emitted).toBeTruthy();
        expect(emitted?.[0][0]).toMatchObject({id: 'office', kind: 'zone'});
        expect(wrapper.find('.fnd__panel').exists()).toBe(false);
        wrapper.unmount();
    });

    it('marks the active item with the active class', async () => {
        const wrapper = mountDropdown({activeId: 'office', activeKind: 'zone'});
        await wrapper.find('.fnd__trigger').trigger('click');
        const items = wrapper.findAll('.fnd__item');
        expect(items[0].classes()).not.toContain('fnd__item--active');
        expect(items[1].classes()).toContain('fnd__item--active');
        wrapper.unmount();
    });

    it('does not mark an item active when the kind does not match the active kind', async () => {
        // id 'office' belongs to 'zone' kind; activeKind 'device' should NOT match.
        const wrapper = mountDropdown({
            activeId: 'office',
            activeKind: 'device'
        });
        await wrapper.find('.fnd__trigger').trigger('click');
        const active = wrapper.findAll('.fnd__item--active');
        expect(active).toHaveLength(0);
        wrapper.unmount();
    });

    it('closes on Escape so keyboard users can dismiss without clicking', async () => {
        const wrapper = mountDropdown();
        await wrapper.find('.fnd__trigger').trigger('click');
        expect(wrapper.find('.fnd__panel').exists()).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.fnd__panel').exists()).toBe(false);
        wrapper.unmount();
    });

    it('closes when a pointerdown lands outside the host', async () => {
        const wrapper = mountDropdown();
        await wrapper.find('.fnd__trigger').trigger('click');
        const outside = document.createElement('div');
        document.body.appendChild(outside);
        const event = new PointerEvent('pointerdown', {bubbles: true});
        outside.dispatchEvent(event);
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.fnd__panel').exists()).toBe(false);
        wrapper.unmount();
    });

    it('renders an empty hint when a section has no items so users know nothing is missing', async () => {
        const wrapper = mount(FloorNavDropdown, {
            props: {
                sections: [
                    {
                        title: 'Floors',
                        items: [],
                        emptyHint: 'No floors added yet.'
                    }
                ],
                activeId: null,
                activeKind: null,
                triggerLabel: 'Floors'
            },
            attachTo: document.body
        });
        await wrapper.find('.fnd__trigger').trigger('click');
        expect(wrapper.find('.fnd__empty').text()).toBe('No floors added yet.');
        wrapper.unmount();
    });

    it('renders the click handler harmlessly when emitted with no listener', () => {
        const stub = vi.fn();
        expect(stub).not.toHaveBeenCalled();
    });
});
