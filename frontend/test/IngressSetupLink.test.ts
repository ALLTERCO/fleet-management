import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import IngressSetupLink from '@/components/ingress/IngressSetupLink.vue';

function inputValues(wrapper: ReturnType<typeof mount>): string[] {
    return wrapper
        .findAll('input')
        .map((i) => (i.element as HTMLInputElement).value);
}

describe('IngressSetupLink', () => {
    it('shows the url, token, and the shown-once warning', () => {
        const w = mount(IngressSetupLink, {
            props: {url: 'wss://fm/shelly?id=x&token=abc', token: 'abc'},
            global: {stubs: {Button: true}}
        });
        expect(w.text()).toContain('shown only once');
        expect(inputValues(w)).toContain('wss://fm/shelly?id=x&token=abc');
        expect(inputValues(w)).toContain('abc');
    });

    it('omits the token field for the certificate flow (no token)', () => {
        const w = mount(IngressSetupLink, {
            props: {url: 'wss://fm/shelly?id=x'},
            global: {stubs: {Button: true}}
        });
        const values = inputValues(w);
        expect(values).toContain('wss://fm/shelly?id=x');
        expect(values).toHaveLength(1);
    });
});
