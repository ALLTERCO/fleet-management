// Shows a rule's condition in plain English, with the raw JSON tucked into a
// collapsible for power users. Replaces the bare JSON <pre> on the preview
// modal and the rule detail page.

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import RuleConditionView from '@/components/core/RuleConditionView.vue';

describe('RuleConditionView', () => {
    it('renders the plain-English condition', () => {
        const wrapper = mount(RuleConditionView, {
            props: {
                kind: 'component_threshold',
                config: {
                    component: 'temperature:0',
                    field: 'tC',
                    operator: 'gt',
                    threshold: 30
                }
            }
        });
        expect(wrapper.text()).toContain('temperature goes above 30 °C');
    });

    it('keeps the raw JSON available in a collapsible', () => {
        const wrapper = mount(RuleConditionView, {
            props: {
                kind: 'component_state',
                config: {component: 'switch:0', field: 'output', equals: true}
            }
        });
        expect(wrapper.find('details').exists()).toBe(true);
        expect(wrapper.find('pre').text()).toContain('"component": "switch:0"');
    });

    it('omits the raw block when the config has no settings', () => {
        const wrapper = mount(RuleConditionView, {
            props: {kind: 'smoke_alarm', config: {}}
        });
        expect(wrapper.find('details').exists()).toBe(false);
        expect(wrapper.text()).toContain('Smoke alarm');
    });
});
