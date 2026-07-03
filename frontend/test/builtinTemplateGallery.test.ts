/** BuiltinTemplateGallery — renders the backend starter templates
 *  (Rule.ListTemplates), grouped by category, with search. */

import type {AlertRuleTemplate} from '@api/alert';
import {flushPromises, mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';

const {listTemplates} = vi.hoisted(() => ({listTemplates: vi.fn()}));
vi.mock('@/stores/alerts', () => ({useAlertsStore: () => ({listTemplates})}));

import BuiltinTemplateGallery from '@/components/core/BuiltinTemplateGallery.vue';

function tpl(
    templateKey: string,
    category: string,
    label: string,
    severity: AlertRuleTemplate['severity'],
    kind: AlertRuleTemplate['kind']
): AlertRuleTemplate {
    return {
        templateKey,
        category,
        label,
        severity,
        kind,
        description: `${label} description`
    } as AlertRuleTemplate;
}

const FIXTURE: AlertRuleTemplate[] = [
    tpl(
        'builtin:battery_below_20',
        'Power',
        'Battery below 20%',
        'warning',
        'battery_below'
    ),
    tpl(
        'builtin:smoke_alarm_any',
        'Safety',
        'Any smoke alarm',
        'critical',
        'smoke_alarm'
    ),
    tpl('builtin:relay_on', 'State', 'Relay turns on', 'info', 'component_state')
];

async function mountGallery(query = '') {
    listTemplates.mockResolvedValue(FIXTURE);
    const wrapper = mount(BuiltinTemplateGallery, {props: {query}});
    await flushPromises();
    return wrapper;
}

describe('BuiltinTemplateGallery layout', () => {
    it('renders one card per backend template', async () => {
        const wrapper = await mountGallery();
        expect(wrapper.findAll('.btg__card').length).toBe(FIXTURE.length);
    });

    it('renders one section per distinct category', async () => {
        const wrapper = await mountGallery();
        const distinct = new Set(FIXTURE.map((t) => t.category)).size;
        expect(wrapper.findAll('.btg__section').length).toBe(distinct);
    });
});

describe('BuiltinTemplateGallery search', () => {
    it('filters cards to those matching the query', async () => {
        const wrapper = await mountGallery('battery');
        const titles = wrapper
            .findAll('.btg__card-title')
            .map((node) => node.text());
        expect(titles).toEqual(['Battery below 20%']);
    });

    it('shows the empty hint when nothing matches the query', async () => {
        const wrapper = await mountGallery('nothing-matches-this-term');
        expect(wrapper.find('.btg__empty').exists()).toBe(true);
    });

    it('matches against category labels too', async () => {
        const wrapper = await mountGallery('safety');
        const sections = wrapper
            .findAll('.btg__sec-title')
            .map((node) => node.text().toLowerCase());
        expect(sections).toContain('safety');
    });
});

describe('BuiltinTemplateGallery selection', () => {
    it('emits the full template object when a card is clicked', async () => {
        const wrapper = await mountGallery();
        await wrapper.findAll('.btg__card')[0].trigger('click');
        const picked = wrapper.emitted('pick')?.[0]?.[0] as AlertRuleTemplate;
        expect(picked.templateKey).toMatch(/^builtin:/);
    });
});
