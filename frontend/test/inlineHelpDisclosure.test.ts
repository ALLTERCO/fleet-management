/** Unit tests for InlineHelpDisclosure — one behaviour per test. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import InlineHelpDisclosure from '@/components/core/InlineHelpDisclosure.vue';

describe('InlineHelpDisclosure', () => {
    it('renders the question text on the trigger', () => {
        const wrapper = mount(InlineHelpDisclosure, {
            props: {question: 'How do I get this URL?'}
        });
        expect(wrapper.find('.ihd__trigger').text()).toContain(
            'How do I get this URL?'
        );
    });

    it('starts collapsed so the help body is not in the DOM', () => {
        const wrapper = mount(InlineHelpDisclosure, {
            props: {question: 'How?'},
            slots: {default: 'Helpful explanation'}
        });
        expect(wrapper.find('.ihd__body').exists()).toBe(false);
    });

    it('expands the body when the trigger is clicked', async () => {
        const wrapper = mount(InlineHelpDisclosure, {
            props: {question: 'How?'},
            slots: {default: 'Helpful explanation'}
        });
        await wrapper.find('.ihd__trigger').trigger('click');
        expect(wrapper.find('.ihd__body').exists()).toBe(true);
        expect(wrapper.find('.ihd__body').text()).toContain(
            'Helpful explanation'
        );
    });

    it('collapses the body when clicked a second time', async () => {
        const wrapper = mount(InlineHelpDisclosure, {
            props: {question: 'How?'},
            slots: {default: 'Helpful explanation'}
        });
        const trigger = wrapper.find('.ihd__trigger');
        await trigger.trigger('click');
        await trigger.trigger('click');
        expect(wrapper.find('.ihd__body').exists()).toBe(false);
    });

    it('reflects open state on aria-expanded for screen readers', async () => {
        const wrapper = mount(InlineHelpDisclosure, {
            props: {question: 'How?'}
        });
        const trigger = wrapper.find('.ihd__trigger');
        expect(trigger.attributes('aria-expanded')).toBe('false');
        await trigger.trigger('click');
        expect(trigger.attributes('aria-expanded')).toBe('true');
    });
});
