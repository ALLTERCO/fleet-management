// The contract the actions/plugins bug violated: in LIST mode PageTemplate
// renders the list, NOT its default slot — so anything a page drops in the
// default slot (a modal!) disappears. The #modals slot always renders. These
// tests lock that contract so a page can trust where to put a modal.

import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';
import PageTemplate from '@/components/core/PageTemplate.vue';

vi.mock('vue-router', () => ({
    useRoute: () => ({path: '/x', fullPath: '/x'}),
    useRouter: () => ({push: vi.fn()})
}));

const stubs = {
    ErrorBoundary: {template: '<div><slot /></div>'},
    GlassShell: {template: '<div><slot /></div>'},
    PageToolbar: true,
    UniversalSearch: true,
    ListSourceRenderer: {template: '<div class="list-rendered" />'},
    Skeleton: true,
    PageTopMenu: true
};

describe('PageTemplate slot contract', () => {
    it('list mode: default slot is NOT rendered; #modals IS', () => {
        const wrapper = mount(PageTemplate, {
            props: {title: 'X', items: [{id: 1}]},
            slots: {
                default: '<div class="default-content" />',
                item: '<div />',
                modals: '<div class="modal-marker" />'
            },
            global: {stubs}
        });

        expect(wrapper.find('.list-rendered').exists()).toBe(true);
        // The footgun: default-slot content is dropped in list mode.
        expect(wrapper.find('.default-content').exists()).toBe(false);
        // The fix: modals always render.
        expect(wrapper.find('.modal-marker').exists()).toBe(true);
    });

    it('content mode (no items): default slot AND #modals render', () => {
        const wrapper = mount(PageTemplate, {
            props: {title: 'X'},
            slots: {
                default: '<div class="default-content" />',
                modals: '<div class="modal-marker" />'
            },
            global: {stubs}
        });

        expect(wrapper.find('.default-content').exists()).toBe(true);
        expect(wrapper.find('.modal-marker').exists()).toBe(true);
    });
});
