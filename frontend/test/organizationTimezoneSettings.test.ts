import {flushPromises, mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// Org timezone picker: the General-settings control that sets
// organization.profile.timezone_default (the anchor for report bill periods).
// These pin the behavior the type-checker can't: which RPC is sent, the
// clear-to-null mapping, and the optimistic revert on failure.

const ws = vi.hoisted(() => ({sendRPC: vi.fn()}));
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}));
const auth = vi.hoisted(() => ({isAdmin: true}));

vi.mock('@/tools/websocket', () => ws);
vi.mock('@/stores/toast', () => ({useToastStore: () => toast}));
vi.mock('@/stores/auth', () => ({useAuthStore: () => auth}));

import Dropdown from '@/components/core/Dropdown.vue';
import OrganizationSettings from '@/components/pages/settings/OrganizationSettings.vue';

function profile(timezoneDefault: string | null) {
    return {
        id: 'o1',
        name: null,
        displayName: null,
        timezoneDefault,
        localeDefault: null,
        currencyDefault: null,
        unitSystemDefault: null,
        metadata: {}
    };
}

// Route sendRPC by method so a test only states the bits it cares about.
function wireRpc(opts: {
    saved?: string | null;
    setProfile?: () => Promise<unknown>;
}) {
    ws.sendRPC.mockImplementation((_dst, method) => {
        if (method === 'organization.getprofile') {
            return Promise.resolve(profile(opts.saved ?? null));
        }
        return (opts.setProfile ?? (() => Promise.resolve({})))();
    });
}

async function open() {
    const w = mount(OrganizationSettings);
    await flushPromises();
    return w;
}

function picker(w: ReturnType<typeof mount>) {
    return w.findComponent(Dropdown);
}

beforeEach(() => {
    setActivePinia(createPinia());
    ws.sendRPC.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    auth.isAdmin = true;
});

describe('OrganizationSettings — loads the saved zone', () => {
    it('fetches the org profile and preselects its timezone', async () => {
        wireRpc({saved: 'Europe/Sofia'});
        const w = await open();
        expect(ws.sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'organization.getprofile',
            {}
        );
        expect(picker(w).props('default')).toBe('Europe/Sofia');
    });

    it('lists the System-default entry first, then zones grouped by region', async () => {
        wireRpc({saved: null});
        const w = await open();
        const groups = picker(w).props('groups') as {
            label: string;
            items: {value: string; label: string}[];
        }[];
        expect(groups[0].label).toBe('Default');
        const europe = groups.find((g) => g.label === 'Europe');
        expect(europe?.items.some((i) => i.value === 'Europe/Sofia')).toBe(
            true
        );
    });
});

describe('OrganizationSettings — saves a chosen zone', () => {
    it('sends organization.setprofile with the picked zone and toasts success', async () => {
        wireRpc({saved: null});
        const w = await open();
        picker(w).vm.$emit('selected', 'America/New_York');
        await flushPromises();
        expect(ws.sendRPC).toHaveBeenLastCalledWith(
            'FLEET_MANAGER',
            'organization.setprofile',
            {patch: {timezoneDefault: 'America/New_York'}}
        );
        expect(toast.success).toHaveBeenCalled();
    });

    // Regression: "System default" must clear the column, not write the
    // sentinel string — the backend treats null as "clear".
    it('maps the System-default choice to a null patch', async () => {
        wireRpc({saved: 'Europe/Sofia'});
        const w = await open();
        const unset = (
            picker(w).props('groups') as {items: {value: string}[]}[]
        )[0].items[0].value;
        picker(w).vm.$emit('selected', unset);
        await flushPromises();
        expect(ws.sendRPC).toHaveBeenLastCalledWith(
            'FLEET_MANAGER',
            'organization.setprofile',
            {patch: {timezoneDefault: null}}
        );
    });
});

describe('OrganizationSettings — failure is not silent', () => {
    // Regression: optimistic UI must roll back so the dropdown never shows a
    // value the server rejected.
    it('reverts the selection and toasts an error when the save fails', async () => {
        wireRpc({
            saved: 'Europe/Sofia',
            setProfile: () => Promise.reject(new Error('boom'))
        });
        const w = await open();
        picker(w).vm.$emit('selected', 'Asia/Tokyo');
        await flushPromises();
        expect(toast.error).toHaveBeenCalled();
        expect(picker(w).props('default')).toBe('Europe/Sofia');
    });
});

describe('OrganizationSettings — permission gate', () => {
    it('disables the picker for a non-admin', async () => {
        auth.isAdmin = false;
        wireRpc({saved: null});
        const w = await open();
        expect(picker(w).props('disabled')).toBe(true);
    });
});
