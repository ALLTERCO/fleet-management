/** Unit tests for SectionCard — one behaviour per test. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import SectionCard from '@/components/core/SectionCard.vue';

describe('SectionCard layout', () => {
    it('renders the title in the header', () => {
        const wrapper = mount(SectionCard, {
            props: {title: 'Channel details'}
        });
        expect(wrapper.find('.sc__title').text()).toBe('Channel details');
    });

    it('omits the hint paragraph when no hint prop is provided', () => {
        const wrapper = mount(SectionCard, {
            props: {title: 'Schedule'}
        });
        expect(wrapper.find('.sc__hint').exists()).toBe(false);
    });

    it('renders the hint paragraph when a hint prop is provided', () => {
        const wrapper = mount(SectionCard, {
            props: {
                title: 'Schedule',
                hint: 'Optional quiet window — silences delivery overnight.'
            }
        });
        expect(wrapper.find('.sc__hint').text()).toContain('Optional quiet');
    });

    it('renders the default slot inside the body container', () => {
        const wrapper = mount(SectionCard, {
            props: {title: 'X'},
            slots: {default: '<p>inside</p>'}
        });
        expect(wrapper.find('.sc__body').html()).toContain('<p>inside</p>');
    });

    it('renders the aside slot only when content is provided', () => {
        const wrapper = mount(SectionCard, {
            props: {title: 'X'},
            slots: {aside: '<button class="probe">Test</button>'}
        });
        expect(wrapper.find('.sc__aside .probe').exists()).toBe(true);
    });
});
