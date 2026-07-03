/** Unit tests for AlertKindPicker — one behaviour per test. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import AlertKindPicker from '@/components/core/AlertKindPicker.vue';
import {listAllRuleKinds} from '@/helpers/ruleKinds';

describe('AlertKindPicker layout', () => {
    it('renders one section per known rule category', () => {
        const wrapper = mount(AlertKindPicker);
        expect(wrapper.findAll('.akp__section').length).toBe(4);
    });

    it('places the safety section first because life-safety alerts dominate', () => {
        const wrapper = mount(AlertKindPicker);
        expect(wrapper.findAll('.akp__sec-title')[0].text()).toBe('Safety');
    });

    it('renders one card per known rule kind when nothing is filtered out', () => {
        const wrapper = mount(AlertKindPicker);
        expect(wrapper.findAll('.akp__card').length).toBe(
            listAllRuleKinds().length
        );
    });
});

describe('AlertKindPicker search', () => {
    it('keeps only matching kinds when the query has a term', () => {
        const wrapper = mount(AlertKindPicker, {props: {query: 'battery'}});
        expect(wrapper.findAll('.akp__card').length).toBe(1);
        expect(wrapper.find('.akp__card').text()).toContain(
            'Battery below threshold'
        );
    });

    it('hides a whole category when no kind in it matches', () => {
        const wrapper = mount(AlertKindPicker, {props: {query: 'battery'}});
        const titles = wrapper
            .findAll('.akp__sec-title')
            .map((node) => node.text());
        expect(titles).not.toContain('Operations');
    });

    it('shows an empty hint when no kind matches the query', () => {
        const wrapper = mount(AlertKindPicker, {
            props: {query: 'nothing-matches-this'}
        });
        expect(wrapper.find('.akp__empty').exists()).toBe(true);
    });
});

describe('AlertKindPicker selection', () => {
    it('emits the picked kind when a card is clicked', async () => {
        const wrapper = mount(AlertKindPicker);
        const smoke = wrapper
            .findAll('.akp__card')
            .find((node) => node.text().includes('Smoke alarm'));
        await smoke?.trigger('click');
        expect(wrapper.emitted('pick')?.[0]?.[0]).toBe('smoke_alarm');
    });
});
