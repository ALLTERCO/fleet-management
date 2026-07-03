/** REGRESSION: GlassShell must survive empty slots, late prop changes,
 *  and non-default tiers without dropping its shell identity. */

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import GlassShell from '@/components/core/GlassShell.vue';

describe('REGRESSION: GlassShell renders without a slot', () => {
    it('a lazy-loading page that mounts the shell before content still gets a section', () => {
        const wrapper = mount(GlassShell);
        expect(wrapper.element.tagName).toBe('SECTION');
        expect(wrapper.element.children.length).toBe(0);
    });
});

describe('REGRESSION: GlassShell tier prop is reactive', () => {
    it('switching tier swaps the modifier class, never stacks them', async () => {
        const wrapper = mount(GlassShell, {props: {tier: 1}});
        expect(wrapper.classes()).toContain('gs--tier-1');
        await wrapper.setProps({tier: 4});
        await nextTick();
        expect(wrapper.classes()).toContain('gs--tier-4');
        expect(wrapper.classes()).not.toContain('gs--tier-1');
    });
});

describe('REGRESSION: GlassShell padded prop is reactive', () => {
    it('toggling padded adds and removes the gutter class cleanly', async () => {
        const wrapper = mount(GlassShell, {props: {padded: false}});
        expect(wrapper.classes()).not.toContain('gs--padded');
        await wrapper.setProps({padded: true});
        await nextTick();
        expect(wrapper.classes()).toContain('gs--padded');
        await wrapper.setProps({padded: false});
        await nextTick();
        expect(wrapper.classes()).not.toContain('gs--padded');
    });
});

describe('REGRESSION: GlassShell keeps shell identity across remounts', () => {
    it('every tier from 1 through 5 always carries the base gs class', () => {
        for (const tier of [1, 2, 3, 4, 5] as const) {
            const wrapper = mount(GlassShell, {props: {tier}});
            expect(wrapper.classes()).toContain('gs');
            expect(wrapper.classes()).toContain(`gs--tier-${tier}`);
        }
    });
});

describe('REGRESSION: GlassShell does not stretch on short content', () => {
    it('omits the fill modifier so card-grid pages size to content', () => {
        const wrapper = mount(GlassShell, {
            slots: {default: '<p>just a sentence</p>'}
        });
        expect(wrapper.classes()).not.toContain('gs--fill');
    });

    it('fill can be turned on for split-pane workspaces that need viewport-fill', async () => {
        const wrapper = mount(GlassShell, {props: {fill: false}});
        expect(wrapper.classes()).not.toContain('gs--fill');
        await wrapper.setProps({fill: true});
        expect(wrapper.classes()).toContain('gs--fill');
    });
});
