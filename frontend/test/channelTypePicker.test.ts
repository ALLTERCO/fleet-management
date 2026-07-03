/** Unit tests for ChannelTypePicker — one behaviour per test. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import ChannelTypePicker from '@/components/core/ChannelTypePicker.vue';

describe('ChannelTypePicker', () => {
    it('renders one option per configurable channel type', () => {
        const wrapper = mount(ChannelTypePicker, {
            props: {modelValue: 'email_smtp'}
        });
        expect(wrapper.findAll('.ctp__option').length).toBe(6);
    });

    it('marks the currently selected type as active', () => {
        const wrapper = mount(ChannelTypePicker, {
            props: {modelValue: 'slack_webhook'}
        });
        const active = wrapper.find('.ctp__option--active');
        expect(active.text()).toContain('Slack');
    });

    it('emits update:modelValue when a different option is clicked', async () => {
        const wrapper = mount(ChannelTypePicker, {
            props: {modelValue: 'email_smtp'}
        });
        const teamsOption = wrapper
            .findAll('.ctp__option')
            .find((node) => node.text().includes('Teams'));
        await teamsOption?.trigger('click');
        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted?.at(-1)?.[0]).toBe('teams_workflow_webhook');
    });

    it('exposes the selected option to assistive tech via aria-checked', () => {
        const wrapper = mount(ChannelTypePicker, {
            props: {modelValue: 'telegram_bot'}
        });
        const checked = wrapper
            .findAll('.ctp__option')
            .filter((node) => node.attributes('aria-checked') === 'true');
        expect(checked.length).toBe(1);
        expect(checked[0].text()).toContain('Telegram');
    });

    it('renders the Email option first because it is the most common type', () => {
        const wrapper = mount(ChannelTypePicker, {
            props: {modelValue: 'email_smtp'}
        });
        expect(wrapper.findAll('.ctp__option')[0].text()).toContain('Email');
    });
});
