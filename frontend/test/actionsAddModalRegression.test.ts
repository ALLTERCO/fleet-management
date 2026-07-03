// Regression for the reported bug: on a LIST-mode page, clicking the "+" button
// must open the modal. It broke because the modal lived in PageTemplate's
// default slot (dropped in list mode). This reproduces the exact structure —
// list-mode PageTemplate, a "+" in #actions toggling a modal in #modals — and
// proves the click reveals it.

import {mount} from '@vue/test-utils';
import {defineComponent, ref} from 'vue';
import {describe, expect, it, vi} from 'vitest';
import PageTemplate from '@/components/core/PageTemplate.vue';

vi.mock('vue-router', () => ({
    useRoute: () => ({path: '/x', fullPath: '/x'}),
    useRouter: () => ({push: vi.fn()})
}));

const stubs = {
    ErrorBoundary: {template: '<div><slot /></div>'},
    GlassShell: {template: '<div><slot /></div>'},
    // Render the actions slot so the "+" button is reachable.
    PageToolbar: {template: '<div><slot name="actions" /></div>'},
    UniversalSearch: true,
    ListSourceRenderer: {template: '<div class="list-rendered" />'},
    Skeleton: true,
    PageTopMenu: true
};

const PageWithAddModal = defineComponent({
    components: {PageTemplate},
    setup() {
        const open = ref(false);
        return {open};
    },
    template: `
        <PageTemplate title="Actions" :items="[{id:1}]">
            <template #actions>
                <button class="add-btn" @click="open = true">+</button>
            </template>
            <template #item><div /></template>
            <template #modals>
                <div v-if="open" class="create-modal">create action</div>
            </template>
        </PageTemplate>
    `
});

describe('list-mode page: "+" opens the modal (regression)', () => {
    it('modal is hidden until +, then shown — in list mode', async () => {
        const wrapper = mount(PageWithAddModal, {global: {stubs}});

        // Confirm we are genuinely in list mode (the branch that dropped the
        // default slot).
        expect(wrapper.find('.list-rendered').exists()).toBe(true);
        expect(wrapper.find('.create-modal').exists()).toBe(false);

        await wrapper.find('.add-btn').trigger('click');

        expect(wrapper.find('.create-modal').exists()).toBe(true);
    });
});
