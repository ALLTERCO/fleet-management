// "Test on my devices" — runs Rule.Preview for the draft and reports how many
// devices would fire right now, so a user trusts the rule before saving.

import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {previewRule} = vi.hoisted(() => ({previewRule: vi.fn()}));
vi.mock('@/stores/alerts', () => ({useAlertsStore: () => ({previewRule})}));

import RulePreviewTest from '@/components/core/RulePreviewTest.vue';

beforeEach(() => setActivePinia(createPinia()));

const DRAFT = {
    kind: 'component_state' as const,
    severity: 'info' as const,
    scope: {},
    config: {component: 'switch:0', field: 'output', equals: true}
};

describe('RulePreviewTest', () => {
    it('runs the preview and reports the scanned + matching counts', async () => {
        previewRule.mockResolvedValue({
            matches: [
                {
                    severity: 'info',
                    title: 'Living Room relay on',
                    subject: {subjectType: 'device', subjectId: 'shelly-1'}
                }
            ],
            scanned: 12,
            supportedKind: true,
            truncated: false,
            note: null
        });

        const wrapper = mount(RulePreviewTest, {props: DRAFT});
        await wrapper.find('button').trigger('click');
        await new Promise((r) => setTimeout(r, 0));

        expect(previewRule).toHaveBeenCalledWith({
            kind: 'component_state',
            severity: 'info',
            scope: {},
            config: {component: 'switch:0', field: 'output', equals: true}
        });
        expect(wrapper.text()).toContain('Scanned 12');
        expect(wrapper.text()).toContain('1');
        expect(wrapper.text()).toContain('Living Room relay on');
    });

    it('shows the unsupported note when the kind cannot be previewed', async () => {
        previewRule.mockResolvedValue({
            matches: [],
            scanned: 0,
            supportedKind: false,
            truncated: false,
            note: 'Preview not available for this rule kind.'
        });

        const wrapper = mount(RulePreviewTest, {props: DRAFT});
        await wrapper.find('button').trigger('click');
        await new Promise((r) => setTimeout(r, 0));

        expect(wrapper.text()).toContain(
            'Preview not available for this rule kind.'
        );
    });
});
