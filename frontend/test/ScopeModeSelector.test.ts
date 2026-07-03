import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import ScopeModeSelector from '@/components/core/ScopeModeSelector.vue';

function mountSelector(scopeAll: boolean) {
    return mount(ScopeModeSelector, {
        props: {scopeAll, scope: {}, personaKey: 'operator'},
        global: {stubs: {BoundaryScopePicker: true}}
    });
}

describe('ScopeModeSelector', () => {
    it('hides the resource picker when everything is granted', () => {
        const wrapper = mountSelector(true);
        expect(
            wrapper.findComponent({name: 'BoundaryScopePicker'}).exists()
        ).toBe(false);
        wrapper.unmount();
    });

    it('shows the picker and forwards the role key when scoped', () => {
        const wrapper = mountSelector(false);
        const picker = wrapper.findComponent({name: 'BoundaryScopePicker'});
        expect(picker.exists()).toBe(true);
        expect(picker.props('personaKey')).toBe('operator');
        wrapper.unmount();
    });

    it('emits scope-all changes when the other card is chosen', async () => {
        const wrapper = mountSelector(true);
        const radios = wrapper.findAll('input[type="radio"]');
        await radios[1].trigger('change');
        expect(wrapper.emitted('update:scopeAll')?.at(-1)).toEqual([false]);
        wrapper.unmount();
    });
});
