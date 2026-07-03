import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import {defineComponent} from 'vue';
import BottomSheet from '@/components/core/BottomSheet.vue';

const Host = defineComponent({
    components: {BottomSheet},
    props: {snap: {type: String, default: 'half'}, visible: Boolean},
    template: `
        <BottomSheet :visible="visible" :snap="snap">
            <div data-testid="content">payload</div>
        </BottomSheet>
    `
});

describe('BottomSheet', () => {
    it('renders nothing when not visible', () => {
        const w = mount(Host, {props: {visible: false}});
        expect(w.find('.sheet').exists()).toBe(false);
    });

    it('renders content when visible', () => {
        const w = mount(Host, {props: {visible: true}});
        expect(w.find('[data-testid="content"]').text()).toBe('payload');
    });

    it('applies a height in viewport units matching the active snap', () => {
        const w = mount(Host, {props: {visible: true, snap: 'half'}});
        const style = w.get('.sheet').attributes('style') ?? '';
        expect(style).toMatch(/height:\s*50vh/);
    });

    it('renders the drag grip with an accessible label', () => {
        const w = mount(Host, {props: {visible: true}});
        expect(w.get('.sheet__grip').attributes('aria-label')).toBe(
            'Drag to resize'
        );
    });
});
