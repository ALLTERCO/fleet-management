import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';
import PageTemplate from '@/components/core/PageTemplate.vue';

vi.mock('@/constants', async () => {
    const actual = await vi.importActual<object>('@/constants');
    return {
        ...actual,
        FLEET_MANAGER_HTTP: 'http://fleet-manager.local'
    };
});

vi.mock('vue-router', () => ({
    useRoute: () => ({path: '/settings/app'}),
    useRouter: () => ({push: vi.fn()})
}));

describe('PageTemplate external tabs', () => {
    it('opens backend API docs from the Fleet Manager origin', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const wrapper = mount(PageTemplate, {
            props: {
                title: 'Settings',
                tabs: [
                    {
                        label: 'API Reference',
                        path: '/api/docs',
                        external: true
                    }
                ]
            },
            slots: {default: '<div />'},
            global: {
                stubs: {
                    ErrorBoundary: {template: '<div><slot /></div>'},
                    GlassShell: {template: '<div><slot /></div>'},
                    UniversalSearch: true,
                    ListSourceRenderer: true,
                    Skeleton: true,
                    // Account menu pulls in the auth store (Pinia); the tab
                    // button under test does not need it.
                    PageTopMenu: true
                }
            }
        });

        await wrapper.get('.route-tabs__btn').trigger('click');

        expect(open).toHaveBeenCalledWith(
            'http://fleet-manager.local/api/docs',
            '_blank',
            'noopener,noreferrer'
        );
        open.mockRestore();
    });
});
