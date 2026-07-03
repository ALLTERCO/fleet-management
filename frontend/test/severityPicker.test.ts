/** Unit tests for SeverityPicker — one behaviour per test. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import SeverityPicker from '@/components/core/SeverityPicker.vue';

describe('SeverityPicker', () => {
    it('renders exactly three options because the severity vocabulary has three levels', () => {
        const wrapper = mount(SeverityPicker, {
            props: {modelValue: 'info'}
        });
        expect(wrapper.findAll('.sp__option').length).toBe(3);
    });

    it('places critical first so the eye reaches the most severe option fastest', () => {
        const wrapper = mount(SeverityPicker, {
            props: {modelValue: 'info'}
        });
        expect(wrapper.findAll('.sp__option')[0].text()).toContain('Critical');
    });

    it('marks the bound severity as active', () => {
        const wrapper = mount(SeverityPicker, {
            props: {modelValue: 'warning'}
        });
        const active = wrapper.find('.sp__option--active');
        expect(active.text()).toContain('Warning');
    });

    it('emits the new severity when a different option is pressed', async () => {
        const wrapper = mount(SeverityPicker, {
            props: {modelValue: 'info'}
        });
        const critical = wrapper
            .findAll('.sp__option')
            .find((node) => node.text().includes('Critical'));
        await critical?.trigger('click');
        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted?.at(-1)?.[0]).toBe('critical');
    });

    it('exposes the active option to assistive tech via aria-checked', () => {
        const wrapper = mount(SeverityPicker, {
            props: {modelValue: 'critical'}
        });
        const checked = wrapper
            .findAll('.sp__option')
            .filter((node) => node.attributes('aria-checked') === 'true');
        expect(checked.length).toBe(1);
        expect(checked[0].text()).toContain('Critical');
    });
});
