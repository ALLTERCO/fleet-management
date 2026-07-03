// The live "reads as" line: When [trigger] on [scope], notify [channels].

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import RuleReadsAs from '@/components/core/RuleReadsAs.vue';

describe('RuleReadsAs', () => {
    it('reads the full sentence with scope and channel labels', () => {
        const wrapper = mount(RuleReadsAs, {
            props: {
                kind: 'component_state',
                config: {component: 'switch:0', field: 'output', equals: true},
                scopeLabel: 'Warehouse',
                channelLabel: 'Slack'
            }
        });
        expect(wrapper.text()).toContain(
            'When a relay turns on on Warehouse, notify Slack.'
        );
    });

    it('uses friendly defaults when scope and channel are not set', () => {
        const wrapper = mount(RuleReadsAs, {
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
        expect(wrapper.text()).toContain(
            'When temperature goes above 30 °C on these devices, notify your channels.'
        );
    });
});
