// Modals render in PageTemplate's #modals slot. That slot must sit inside its
// own ErrorBoundary so a modal that throws during render shows a fallback
// instead of blanking the whole page. This proves the boundary is wired and
// isolates the modal error from the page content.

import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent} from 'vue';
import {describe, expect, it, vi} from 'vitest';
import PageTemplate from '@/components/core/PageTemplate.vue';

vi.mock('vue-router', () => ({
    useRoute: () => ({path: '/x', fullPath: '/x'}),
    useRouter: () => ({push: vi.fn()})
}));

// Throws while mounting — the nearest ErrorBoundary must catch it.
const ThrowingModal = defineComponent({
    setup() {
        throw new Error('modal exploded');
    },
    render: () => null
});

// Keep the real ErrorBoundary; stub only the heavy, unrelated children.
const stubs = {
    GlassShell: {template: '<div><slot /></div>'},
    PageToolbar: true,
    UniversalSearch: true,
    ListSourceRenderer: true,
    Skeleton: true,
    PageTopMenu: true
};

describe('PageTemplate #modals error boundary', () => {
    it('a throwing modal shows the fallback and leaves page content intact', async () => {
        // Vue logs the captured error; silence it to keep test output clean.
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const wrapper = mount(PageTemplate, {
            props: {title: 'X'},
            slots: {
                default: '<div class="page-content">content</div>',
                modals: ThrowingModal
            },
            global: {stubs}
        });
        await flushPromises();

        // Page content lives in a different boundary, so it still renders.
        expect(wrapper.find('.page-content').exists()).toBe(true);
        // The modal boundary caught the error and rendered its fallback.
        expect(wrapper.text()).toContain('Something went wrong');
        errSpy.mockRestore();
    });

    it('renders modal content normally when nothing throws', async () => {
        const wrapper = mount(PageTemplate, {
            props: {title: 'X'},
            slots: {
                default: '<div class="page-content">content</div>',
                modals: '<div class="ok-modal">a modal</div>'
            },
            global: {stubs}
        });
        await flushPromises();

        expect(wrapper.find('.ok-modal').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Something went wrong');
    });
});
