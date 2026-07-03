import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import GlassShell from '@/components/core/GlassShell.vue';

describe('GlassShell', () => {
    it('defaults to tier 1', () => {
        const wrapper = mount(GlassShell);
        expect(wrapper.classes()).toContain('gs--tier-1');
    });

    it('reflects the requested tier on the root', () => {
        const wrapper = mount(GlassShell, {props: {tier: 3}});
        expect(wrapper.classes()).toContain('gs--tier-3');
    });

    it('omits padding by default so split-pane consumers fill edge-to-edge', () => {
        const wrapper = mount(GlassShell);
        expect(wrapper.classes()).not.toContain('gs--padded');
    });

    it('opts into padding when asked', () => {
        const wrapper = mount(GlassShell, {props: {padded: true}});
        expect(wrapper.classes()).toContain('gs--padded');
    });

    it('renders slotted children', () => {
        const wrapper = mount(GlassShell, {
            slots: {default: '<p class="probe">inside</p>'}
        });
        expect(wrapper.find('.probe').text()).toBe('inside');
    });

    it('uses the semantic section element', () => {
        const wrapper = mount(GlassShell);
        expect(wrapper.element.tagName).toBe('SECTION');
    });

    it('is content-sized by default', () => {
        const wrapper = mount(GlassShell);
        expect(wrapper.classes()).not.toContain('gs--fill');
    });

    it('opts into viewport-fill when fill is set', () => {
        const wrapper = mount(GlassShell, {props: {fill: true}});
        expect(wrapper.classes()).toContain('gs--fill');
    });
});
