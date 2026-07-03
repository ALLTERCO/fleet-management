// The quick-pick chip row, fed by the backend starters. Clicking a chip emits
// the rule config it carries.

import type {AlertRuleTemplate} from '@api/alert';
import {flushPromises, mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';

const {listTemplates} = vi.hoisted(() => ({listTemplates: vi.fn()}));
vi.mock('@/stores/alerts', () => ({useAlertsStore: () => ({listTemplates})}));

import RulePresetChips from '@/components/core/RulePresetChips.vue';

function tpl(
    templateKey: string,
    kind: AlertRuleTemplate['kind'],
    label: string,
    config: Record<string, unknown>
): AlertRuleTemplate {
    return {templateKey, kind, label, config} as AlertRuleTemplate;
}

const TEMPLATES: AlertRuleTemplate[] = [
    tpl('builtin:relay_on', 'component_state', 'Relay turns on', {
        component: 'switch:0',
        field: 'output',
        equals: true
    }),
    tpl(
        'builtin:temp_above_30c',
        'component_threshold',
        'Temperature above 30 °C',
        {
            component: 'temperature:0',
            field: 'tC',
            operator: 'gt',
            threshold: 30
        }
    )
];

async function mountChips(kind: AlertRuleTemplate['kind']) {
    listTemplates.mockResolvedValue(TEMPLATES);
    const wrapper = mount(RulePresetChips, {props: {kind}});
    await flushPromises();
    return wrapper;
}

describe('RulePresetChips', () => {
    it('shows the component_state starters and emits the relay-on config', async () => {
        const wrapper = await mountChips('component_state');
        const relayOn = wrapper
            .findAll('button')
            .find((b) => b.text().includes('Relay turns on'));
        expect(relayOn).toBeDefined();
        await relayOn!.trigger('click');
        expect(wrapper.emitted('pick')?.[0][0]).toEqual({
            component: 'switch:0',
            field: 'output',
            equals: true
        });
    });

    it('shows the sensor starters for component_threshold', async () => {
        const wrapper = await mountChips('component_threshold');
        const temp = wrapper
            .findAll('button')
            .find((b) => b.text().includes('Temperature above 30 °C'));
        expect(temp).toBeDefined();
        await temp!.trigger('click');
        expect(wrapper.emitted('pick')?.[0][0]).toEqual({
            component: 'temperature:0',
            field: 'tC',
            operator: 'gt',
            threshold: 30
        });
    });

    it('renders nothing for a kind without quick-picks', async () => {
        const wrapper = await mountChips('device_offline');
        expect(wrapper.findAll('button')).toHaveLength(0);
    });
});
