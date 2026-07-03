// Component: DashboardState — pins the three-state contract (loading,
// empty, error) that every dash/* page depends on for its overlays. If
// the render logic drifts (wrong icon, missing retry button, swapped
// classes) downstream pages would silently change UX, so we lock the
// contract here.

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashboardState from '@/components/dashboard/DashboardState.vue';

describe('DashboardState', () => {
    it('renders loading state with default spinner icon', () => {
        const wrapper = mount(DashboardState, {
            props: {state: 'loading', title: 'Loading'}
        });
        expect(wrapper.find('.dsx--loading').exists()).toBe(true);
        expect(wrapper.find('.dsx__title').text()).toBe('Loading');
        expect(wrapper.find('.dsx__icon').classes()).toContain('fa-spinner');
        expect(wrapper.attributes('aria-busy')).toBe('true');
    });

    it('renders empty state with table-cells default icon', () => {
        const wrapper = mount(DashboardState, {
            props: {state: 'empty', title: 'No data', message: 'Try later'}
        });
        expect(wrapper.find('.dsx--loading').exists()).toBe(false);
        expect(wrapper.find('.dsx__icon').classes()).toContain(
            'fa-table-cells-large'
        );
        expect(wrapper.find('.dsx__message').text()).toBe('Try later');
    });

    it('renders error state with detail line and retry button', async () => {
        const wrapper = mount(DashboardState, {
            props: {
                state: 'error',
                title: 'Boom',
                error: 'connection refused'
            }
        });
        expect(wrapper.find('.dsx--error').exists()).toBe(true);
        expect(wrapper.find('.dsx__icon').classes()).toContain(
            'fa-triangle-exclamation'
        );
        expect(wrapper.find('.dsx__error-detail').text()).toBe(
            'connection refused'
        );
        const retry = wrapper.find('button');
        expect(retry.exists()).toBe(true);
        expect(retry.text()).toContain('Retry');
        await retry.trigger('click');
        expect(wrapper.emitted('retry')?.length).toBe(1);
    });

    it('renders CTA only when ctaLabel is provided on empty state', async () => {
        const wrapper = mount(DashboardState, {
            props: {state: 'empty', ctaLabel: 'New dashboard'}
        });
        const button = wrapper.find('button');
        expect(button.text()).toContain('New dashboard');
        await button.trigger('click');
        expect(wrapper.emitted('cta')?.length).toBe(1);
    });

    it('omits the action area when ctaLabel is missing on empty state', () => {
        const wrapper = mount(DashboardState, {
            props: {state: 'empty'}
        });
        expect(wrapper.find('button').exists()).toBe(false);
    });

    it('honours a custom icon prop over the state default', () => {
        const wrapper = mount(DashboardState, {
            props: {state: 'empty', icon: 'fas fa-shield-halved'}
        });
        expect(wrapper.find('.dsx__icon').classes()).toContain(
            'fa-shield-halved'
        );
    });

    it('uses a custom retry label when provided', () => {
        const wrapper = mount(DashboardState, {
            props: {state: 'error', retryLabel: 'Try again'}
        });
        expect(wrapper.find('button').text()).toContain('Try again');
    });
});
