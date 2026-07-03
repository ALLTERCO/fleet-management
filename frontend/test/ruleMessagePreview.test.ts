// Channel-aware preview: shows which channels receive the alert and how the
// rendered headline + message read, using Notification.RenderTemplate.

import {mount} from '@vue/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {renderTemplate} = vi.hoisted(() => ({renderTemplate: vi.fn()}));
vi.mock('@/stores/notifications', () => ({
    useNotificationsStore: () => ({renderTemplate})
}));

import RuleMessagePreview from '@/components/core/RuleMessagePreview.vue';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    renderTemplate.mockReset();
    renderTemplate.mockImplementation(async ({template}) => ({
        rendered: template === 'H' ? 'Living Room relay on' : 'It turned on.',
        missingTokens: [],
        truncated: false,
        tokens: []
    }));
});

describe('RuleMessagePreview', () => {
    it('lists the chosen channels and the rendered headline + message', async () => {
        const wrapper = mount(RuleMessagePreview, {
            props: {
                channels: [
                    {label: 'Email', bodyKind: 'email'},
                    {label: 'SMS', bodyKind: 'fallback'}
                ],
                summary: 'H',
                message: 'M',
                ruleKind: 'component_state'
            }
        });
        await flush();

        expect(wrapper.text()).toContain('Email');
        expect(wrapper.text()).toContain('SMS');
        expect(wrapper.text()).toContain('Living Room relay on');
        expect(wrapper.text()).toContain('It turned on.');
    });

    it('prompts to pick a channel when none are chosen', () => {
        const wrapper = mount(RuleMessagePreview, {
            props: {channels: [], summary: 'H', message: 'M'}
        });
        expect(wrapper.text()).toContain('Pick a channel');
    });
});
