import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';
import DashViewActions from '@/components/dashboard/DashViewActions.vue';
import type {DashChromeActions} from '@/stores/dashboardChrome';

function makeActions(
    overrides: Partial<DashChromeActions> = {}
): DashChromeActions {
    return {
        onRefresh: vi.fn(),
        onShare: vi.fn(),
        onToggleEdit: vi.fn(),
        onAddWidget: vi.fn(),
        onOpenManage: vi.fn(),
        canEdit: false,
        canShare: false,
        loading: false,
        ...overrides
    };
}

describe('DashViewActions', () => {
    it('keeps dashboard actions inside the kebab menu', async () => {
        const without = mount(DashViewActions, {
            props: {actions: makeActions()}
        });
        expect(without.find('[aria-label="Refresh dashboard"]').exists()).toBe(
            false
        );
        expect(without.find('[aria-label="More actions"]').exists()).toBe(true);
        expect(without.find('[aria-label="Share dashboard"]').exists()).toBe(
            false
        );
        await without.find('[aria-label="More actions"]').trigger('click');
        const withoutLabels = without
            .findAll('[role="menuitem"]')
            .map((b) => b.text());
        expect(withoutLabels.some((t) => t.includes('Refresh dashboard'))).toBe(
            true
        );
        expect(withoutLabels.some((t) => t.includes('Share dashboard'))).toBe(
            false
        );

        const withShare = mount(DashViewActions, {
            props: {actions: makeActions({canShare: true})}
        });
        expect(withShare.find('[aria-label="Share dashboard"]').exists()).toBe(
            false
        );
        await withShare.find('[aria-label="More actions"]').trigger('click');
        expect(withShare.find('[aria-label="Share dashboard"]').exists()).toBe(
            true
        );
    });

    it('invokes onRefresh / onShare from the kebab menu', async () => {
        const actions = makeActions({canShare: true});
        const wrapper = mount(DashViewActions, {props: {actions}});
        await wrapper.find('[aria-label="More actions"]').trigger('click');
        await wrapper.find('[aria-label="Refresh dashboard"]').trigger('click');
        expect(actions.onRefresh).toHaveBeenCalledOnce();

        await wrapper.find('[aria-label="More actions"]').trigger('click');
        await wrapper.find('[aria-label="Share dashboard"]').trigger('click');
        expect(actions.onShare).toHaveBeenCalledOnce();
    });

    it('disables Refresh and adds spin class while loading', async () => {
        const wrapper = mount(DashViewActions, {
            props: {actions: makeActions({loading: true})}
        });
        await wrapper.find('[aria-label="More actions"]').trigger('click');
        const btn = wrapper.find('[aria-label="Refresh dashboard"]');
        expect(btn.attributes('disabled')).toBeDefined();
        expect(btn.find('i').classes()).toContain('fa-spin');
    });

    it('shows edit-only items in the kebab menu only when canEdit', async () => {
        const wrapper = mount(DashViewActions, {
            props: {actions: makeActions({canEdit: true})}
        });
        await wrapper.find('[aria-label="More actions"]').trigger('click');
        const items = wrapper.findAll('[role="menuitem"]').map((b) => b.text());
        expect(items.some((t) => t.includes('Edit dashboard'))).toBe(true);
        expect(items.some((t) => t.includes('Add widget'))).toBe(true);
        expect(items.some((t) => t.includes('Manage dashboards'))).toBe(true);

        const noEdit = mount(DashViewActions, {
            props: {actions: makeActions()}
        });
        await noEdit.find('[aria-label="More actions"]').trigger('click');
        const labels = noEdit.findAll('[role="menuitem"]').map((b) => b.text());
        expect(labels.some((t) => t.includes('Edit dashboard'))).toBe(false);
        expect(labels.some((t) => t.includes('Add widget'))).toBe(false);
        expect(labels.some((t) => t.includes('Manage dashboards'))).toBe(true);
    });

    it('shows page-specific settings only when the page registers them', async () => {
        const actions = makeActions({
            onOpenSettings: vi.fn(),
            settingsLabel: 'Energy settings'
        });
        const wrapper = mount(DashViewActions, {props: {actions}});
        await wrapper.find('[aria-label="More actions"]').trigger('click');
        const settingsBtn = wrapper
            .findAll('[role="menuitem"]')
            .find((b) => b.text().includes('Energy settings'));
        expect(settingsBtn).toBeTruthy();
        await settingsBtn!.trigger('click');
        expect(actions.onOpenSettings).toHaveBeenCalledOnce();
    });

    it('routes kebab menu selection through the actions handlers', async () => {
        const actions = makeActions({canEdit: true});
        const wrapper = mount(DashViewActions, {props: {actions}});
        await wrapper.find('[aria-label="More actions"]').trigger('click');
        const items = wrapper.findAll('[role="menuitem"]');
        const editBtn = items.find((b) => b.text().includes('Edit dashboard'));
        await editBtn!.trigger('click');
        expect(actions.onToggleEdit).toHaveBeenCalledOnce();
    });
});
