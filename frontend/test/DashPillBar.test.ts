import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/stores/dashboardChrome', () => ({
    useDashboardChromeStore: () => ({actions: null})
}));

import DashPillBar from '@/components/dashboard/DashPillBar.vue';

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('DashPillBar — renders a pill per dashboard so users can switch quickly', () => {
    it('renders one button per dashboard with its name', () => {
        const w = mount(DashPillBar, {
            props: {
                dashboards: [
                    {id: 1, name: 'Fleet'},
                    {id: 2, name: 'Energy'}
                ],
                activeId: 1
            }
        });
        const pills = w.findAll('.dash-pill:not(.dash-pill--skeleton)');
        expect(pills).toHaveLength(2);
        expect(pills[0].text()).toContain('Fleet');
        expect(pills[1].text()).toContain('Energy');
    });

    it('marks the active dashboard with the active class so the user sees where they are', () => {
        const w = mount(DashPillBar, {
            props: {
                dashboards: [{id: 1, name: 'Fleet'}],
                activeId: 1
            }
        });
        expect(w.find('.dash-pill').classes()).toContain('active');
    });

    it('emits select on click so the parent can route the user', async () => {
        const w = mount(DashPillBar, {
            props: {
                dashboards: [{id: 7, name: 'Energy'}],
                activeId: 1
            }
        });
        await w.find('.dash-pill').trigger('click');
        expect(w.emitted('select')?.[0]).toEqual([7]);
    });
});

describe('DashPillBar — skeleton state during first load', () => {
    it('renders placeholder pills while loading and no dashboards have arrived', () => {
        const w = mount(DashPillBar, {
            props: {
                dashboards: [],
                activeId: 0,
                loading: true,
                skeletonCount: 3
            }
        });
        expect(w.findAll('.dash-pill--skeleton')).toHaveLength(3);
    });

    it('prefers real pills the moment dashboards arrive, even if loading is still true', () => {
        const w = mount(DashPillBar, {
            props: {
                dashboards: [{id: 1, name: 'Fleet'}],
                activeId: 1,
                loading: true
            }
        });
        expect(w.findAll('.dash-pill--skeleton')).toHaveLength(0);
        expect(w.findAll('.dash-pill')).toHaveLength(1);
    });
});
