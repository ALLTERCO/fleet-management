import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import FormSection from '@/components/core/FormSection.vue';

describe('FormSection', () => {
    it('renders the title and slot content', () => {
        const wrapper = mount(FormSection, {
            props: {title: 'Identity'},
            slots: {default: '<p class="body">content</p>'}
        });
        expect(wrapper.text()).toContain('Identity');
        expect(wrapper.find('p.body').exists()).toBe(true);
    });

    it('renders the icon only when one is provided', () => {
        const withIcon = mount(FormSection, {
            props: {title: 'Access', icon: 'fas fa-key'}
        });
        expect(withIcon.find('header i.fa-key').exists()).toBe(true);

        const withoutIcon = mount(FormSection, {props: {title: 'Access'}});
        expect(withoutIcon.find('header i').exists()).toBe(false);
    });

    it('renders the badge only when one is provided', () => {
        const withBadge = mount(FormSection, {
            props: {title: 'Access', badge: 'required'}
        });
        expect(withBadge.find('.form-section__badge').text()).toBe('required');

        const withoutBadge = mount(FormSection, {props: {title: 'Access'}});
        expect(withoutBadge.find('.form-section__badge').exists()).toBe(false);
    });
});
