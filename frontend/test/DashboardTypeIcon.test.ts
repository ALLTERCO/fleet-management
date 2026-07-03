// Component: DashboardTypeIcon — verifies the icon class is bound to the
// appearance accent, not the raw type, so 'overview' and 'control' get the
// primary accent (F8 regression).

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashboardTypeIcon from '@/components/dashboard/DashboardTypeIcon.vue';

describe('DashboardTypeIcon', () => {
    it('classic maps to the primary accent class', () => {
        const wrapper = mount(DashboardTypeIcon, {props: {type: 'classic'}});
        expect(wrapper.classes()).toContain('dti--primary');
    });

    it('analytics maps to the success accent class', () => {
        const wrapper = mount(DashboardTypeIcon, {props: {type: 'analytics'}});
        expect(wrapper.classes()).toContain('dti--success');
    });

    it('safety maps to the danger accent class', () => {
        const wrapper = mount(DashboardTypeIcon, {props: {type: 'safety'}});
        expect(wrapper.classes()).toContain('dti--danger');
    });

    it('regression: overview maps to primary (not raw "dti--overview")', () => {
        const wrapper = mount(DashboardTypeIcon, {props: {type: 'overview'}});
        expect(wrapper.classes()).toContain('dti--primary');
        expect(wrapper.classes()).not.toContain('dti--overview');
    });

    it('regression: control maps to primary (not raw "dti--control")', () => {
        const wrapper = mount(DashboardTypeIcon, {props: {type: 'control'}});
        expect(wrapper.classes()).toContain('dti--primary');
        expect(wrapper.classes()).not.toContain('dti--control');
    });

    it('unknown types fall back to neutral', () => {
        const wrapper = mount(DashboardTypeIcon, {props: {type: 'weather'}});
        expect(wrapper.classes()).toContain('dti--neutral');
    });

    it('renders the FontAwesome icon for the type', () => {
        const wrapper = mount(DashboardTypeIcon, {props: {type: 'energy'}});
        const icon = wrapper.find('i');
        expect(icon.classes()).toContain('fa-bolt');
    });
});
