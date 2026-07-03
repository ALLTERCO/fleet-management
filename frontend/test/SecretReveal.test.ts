import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it} from 'vitest';
import SecretReveal from '@/components/core/SecretReveal.vue';

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('SecretReveal', () => {
    it('shows the token and a default shown-once warning', () => {
        const wrapper = mount(SecretReveal, {props: {token: 'fmk_abc123'}});
        expect(wrapper.find('code').text()).toBe('fmk_abc123');
        expect(wrapper.text()).toContain("won't be shown again");
    });

    it('uses the given copy label and emits copy on click', async () => {
        const wrapper = mount(SecretReveal, {
            props: {token: 'x', copyLabel: 'Copy Token'}
        });
        expect(wrapper.text()).toContain('Copy Token');
        await wrapper.find('button').trigger('click');
        expect(wrapper.emitted('copy')).toBeTruthy();
    });

    it('renders a custom warning when provided', () => {
        const wrapper = mount(SecretReveal, {
            props: {token: 'x', warning: 'Store it safely.'}
        });
        expect(wrapper.text()).toContain('Store it safely.');
    });
});
