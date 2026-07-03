import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    connect: vi.fn(),
    close: vi.fn()
}));

vi.mock('@/stores/auth', () => ({
    useAuthStore: () => ({
        canWrite: true,
        isReadOnly: false,
        isAdmin: true,
        isViewer: false,
        permissionsLoaded: true
    })
}));

import AddDeviceButton from '@/components/devices/add/AddDeviceButton.vue';

beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
});

describe('AddDeviceButton — single entry point for the wizard', () => {
    it('renders a primary action labelled Add device so the entry point is unambiguous', () => {
        const w = mount(AddDeviceButton, {attachTo: document.body});
        const btn = w.get('button');
        expect(btn.text()).toContain('Add device');
        expect(btn.attributes('aria-label')).toBe('Add device');
        w.unmount();
    });

    it('keeps the wizard closed until the button is clicked — no surprise modals at mount', () => {
        const w = mount(AddDeviceButton, {attachTo: document.body});
        expect(document.body.querySelector('.adw')).toBeNull();
        w.unmount();
    });

    it('opens the wizard on click so users do not need to know the modal path', async () => {
        const w = mount(AddDeviceButton, {attachTo: document.body});
        await w.get('button').trigger('click');
        await nextTick();
        expect(document.body.querySelector('.adw')).not.toBeNull();
        w.unmount();
    });

    it('hides the textual label in iconOnly mode so it fits a tight action bar', () => {
        const w = mount(AddDeviceButton, {
            props: {iconOnly: true},
            attachTo: document.body
        });
        expect(w.get('button').text()).not.toContain('Add device');
        expect(w.get('button').find('i').classes()).toContain('fa-plus');
        w.unmount();
    });
});
