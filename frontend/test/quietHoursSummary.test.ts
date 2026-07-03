/** Unit tests for QuietHoursSummary — one behaviour per test. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import QuietHoursSummary from '@/components/core/QuietHoursSummary.vue';

const EMPTY_FORM = {start: '', end: '', timezone: ''};
const FILLED_FORM = {start: '22', end: '7', timezone: 'Europe/Sofia'};

describe('QuietHoursSummary collapsed chip', () => {
    it('reads "Add quiet hours" when no fields are set', () => {
        const wrapper = mount(QuietHoursSummary, {
            props: {modelValue: EMPTY_FORM}
        });
        expect(wrapper.text()).toContain('Add quiet hours');
    });

    it('reads the formatted window when fields are set', () => {
        const wrapper = mount(QuietHoursSummary, {
            props: {modelValue: FILLED_FORM}
        });
        expect(wrapper.text()).toContain('Quiet 22:00–07:00');
    });

    it('includes the timezone in the formatted chip', () => {
        const wrapper = mount(QuietHoursSummary, {
            props: {modelValue: FILLED_FORM}
        });
        expect(wrapper.text()).toContain('Europe/Sofia');
    });

    it('falls back to UTC in the chip when timezone is missing', () => {
        const wrapper = mount(QuietHoursSummary, {
            props: {modelValue: {start: '22', end: '7', timezone: ''}}
        });
        expect(wrapper.text()).toContain('UTC');
    });
});

describe('QuietHoursSummary expanded form', () => {
    it('does not render the form fields until the chip is clicked', () => {
        const wrapper = mount(QuietHoursSummary, {
            props: {modelValue: EMPTY_FORM}
        });
        expect(wrapper.find('.qhs__input').exists()).toBe(false);
    });

    it('renders three input fields after the chip is clicked', async () => {
        const wrapper = mount(QuietHoursSummary, {
            props: {modelValue: EMPTY_FORM}
        });
        await wrapper.find('.qhs__chip').trigger('click');
        expect(wrapper.findAll('.qhs__input').length).toBe(3);
    });

    it('emits update:modelValue with the patched start hour', async () => {
        const wrapper = mount(QuietHoursSummary, {
            props: {modelValue: EMPTY_FORM}
        });
        await wrapper.find('.qhs__chip').trigger('click');
        const inputs = wrapper.findAll('.qhs__input');
        await inputs[0].setValue('22');
        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        expect(emitted?.at(-1)?.[0]).toEqual({
            start: '22',
            end: '',
            timezone: ''
        });
    });

    it('emits an empty form when Clear is pressed in expanded mode', async () => {
        const wrapper = mount(QuietHoursSummary, {
            props: {modelValue: FILLED_FORM}
        });
        await wrapper.find('.qhs__chip').trigger('click');
        await wrapper.find('.qhs__clear').trigger('click');
        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted?.at(-1)?.[0]).toEqual(EMPTY_FORM);
    });
});
