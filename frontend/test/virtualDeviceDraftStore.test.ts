import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({
    sendRPC,
    close: vi.fn(),
    connect: vi.fn()
}));

import type {VirtualDeviceProfile} from '@/shell/template-host/virtualDevices';
import {useVirtualDeviceDraftStore} from '@/stores/virtualDeviceDraftStore';
import {roleMatchesCandidate} from '@/helpers/virtualDeviceTemplates';

const fireplaceProfile = (): VirtualDeviceProfile => ({
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: 'org-1',
    key: 'fireplace',
    name: 'Fireplace',
    version: 1,
    roles: [
        {
            roleKey: 'burner',
            label: 'Burner',
            valueType: 'boolean',
            historyMode: 'live_only',
            required: true,
            writable: true
        },
        {
            roleKey: 'flame_temp',
            label: 'Flame temperature',
            valueType: 'number',
            unit: 'C',
            historyMode: 'linked',
            required: false
        }
    ],
    metadata: {}
});

beforeEach(() => {
    setActivePinia(createPinia());
    sendRPC.mockReset();
});

describe('virtualDeviceDraftStore — picking a profile materialises role rows', () => {
    it('hydrates a row per profile role with the profile-defined defaults', () => {
        const store = useVirtualDeviceDraftStore();
        store.selectProfile(fireplaceProfile());
        expect(store.roles.map((r) => r.roleKey)).toEqual([
            'burner',
            'flame_temp'
        ]);
        expect(store.roles[0]).toMatchObject({
            label: 'Burner',
            required: true,
            writable: true,
            historyMode: 'live_only',
            source: null
        });
    });

    it('auto-fills a blank device name from the profile so users skip a step', () => {
        const store = useVirtualDeviceDraftStore();
        store.selectProfile(fireplaceProfile());
        expect(store.details.name).toBe('Fireplace');
    });

    it('does not overwrite a name the user already typed', () => {
        const store = useVirtualDeviceDraftStore();
        store.details.name = 'Plant room hearth';
        store.selectProfile(fireplaceProfile());
        expect(store.details.name).toBe('Plant room hearth');
    });

    it('clearing the profile drops every role row to avoid stale bindings', () => {
        const store = useVirtualDeviceDraftStore();
        store.selectProfile(fireplaceProfile());
        store.selectProfile(null);
        expect(store.roles).toEqual([]);
    });
});

describe('virtualDeviceDraftStore — required-role gating', () => {
    it('treats required roles as bound only when every one has a source', () => {
        const store = useVirtualDeviceDraftStore();
        store.selectProfile(fireplaceProfile());
        expect(store.allRequiredBound).toBe(false);
        store.bindRole('burner', {
            deviceExternalId: 'shelly-1',
            componentKey: 'switch:0'
        });
        expect(store.allRequiredBound).toBe(true);
    });

    it('treats an unbound optional role as fine — only required gates the wizard', () => {
        const store = useVirtualDeviceDraftStore();
        store.selectProfile(fireplaceProfile());
        store.bindRole('burner', {
            deviceExternalId: 'shelly-1',
            componentKey: 'switch:0'
        });
        expect(store.allRequiredBound).toBe(true);
        expect(
            store.roles.find((r) => r.roleKey === 'flame_temp')?.source
        ).toBeNull();
    });
});

describe('virtualDeviceDraftStore — bindingItems strips unbound rows', () => {
    it('only emits draft items for rows that have a source — the backend rejects nulls', () => {
        const store = useVirtualDeviceDraftStore();
        store.selectProfile(fireplaceProfile());
        store.bindRole('burner', {
            deviceExternalId: 'shelly-1',
            componentKey: 'switch:0'
        });
        const items = store.bindingItems();
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            roleKey: 'burner',
            source: {deviceExternalId: 'shelly-1', componentKey: 'switch:0'}
        });
    });
});

describe('virtualDeviceDraftStore — refreshPreview is gated by canPreview', () => {
    it('does not call the backend when there is nothing meaningful to preview', async () => {
        const store = useVirtualDeviceDraftStore();
        await store.refreshPreview();
        expect(sendRPC).not.toHaveBeenCalled();
    });

    it('asks the backend to render once a profile is chosen and at least one role is bound', async () => {
        sendRPC.mockResolvedValue({
            device: {externalId: 'vdev_preview'},
            bindings: [],
            validation: {valid: true, errors: []}
        });
        const store = useVirtualDeviceDraftStore();
        store.setKind('composed');
        store.selectProfile(fireplaceProfile());
        store.details.name = 'Plant room hearth';
        store.bindRole('burner', {
            deviceExternalId: 'shelly-1',
            componentKey: 'switch:0'
        });
        const out = await store.refreshPreview();
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.draft.preview',
            expect.any(Object)
        );
        expect(out?.device.externalId).toBe('vdev_preview');
        expect(store.validation?.valid).toBe(true);
    });

    it('captures preview errors on the store so the UI can show them — and never throws to the caller', async () => {
        sendRPC.mockRejectedValue(new Error('backend down'));
        const store = useVirtualDeviceDraftStore();
        store.setKind('composed');
        store.selectProfile(fireplaceProfile());
        store.details.name = 'Plant room hearth';
        store.bindRole('burner', {
            deviceExternalId: 'shelly-1',
            componentKey: 'switch:0'
        });
        const out = await store.refreshPreview();
        expect(out).toBeNull();
        expect(store.previewError).toBe('backend down');
    });
});

describe('virtualDeviceDraftStore — loadProfiles surfaces RPC failures without throwing', () => {
    it('captures errors so the wizard can show a banner instead of crashing the step', async () => {
        sendRPC.mockRejectedValue(new Error('no network'));
        const store = useVirtualDeviceDraftStore();
        await store.loadProfiles();
        expect(store.profilesError).toBe('no network');
        expect(store.availableProfiles).toEqual([]);
    });
});

describe('virtualDeviceDraftStore — reset clears every input so a second open is clean', () => {
    it('returns the store to its initial blank state after a successful save', () => {
        const store = useVirtualDeviceDraftStore();
        store.setKind('composed');
        store.selectProfile(fireplaceProfile());
        store.details.name = 'noise';
        store.bindRole('burner', {
            deviceExternalId: 'shelly-1',
            componentKey: 'switch:0'
        });
        store.reset();
        expect(store.kind).toBeNull();
        expect(store.profile).toBeNull();
        expect(store.details.name).toBe('');
        expect(store.roles).toEqual([]);
        expect(store.previewState).toBeNull();
    });
});

const cand = (o: Record<string, unknown> = {}) =>
    ({
        deviceExternalId: 'd1',
        deviceName: 'EM',
        componentKey: 'em1:0',
        componentType: 'power',
        dynamicCategory: null,
        writable: false,
        ...o
    }) as any;

describe('draft store parts', () => {
    it('adds a part as a bound role row with a minted roleKey', () => {
        const s = useVirtualDeviceDraftStore();
        s.addPart(cand());
        expect(s.pickedParts.length).toBe(1);
        expect(s.pickedParts[0].roleKey).toBe('power_1');
        expect(s.pickedParts[0].source).toEqual({
            deviceExternalId: 'd1',
            componentKey: 'em1:0'
        });
        expect(s.pickedParts[0].label).toBe('Power');
    });
    it('mints unique roleKeys per type', () => {
        const s = useVirtualDeviceDraftStore();
        s.addPart(cand({componentKey: 'em1:0'}));
        s.addPart(cand({componentKey: 'em1:1'}));
        expect(s.pickedParts.map((p: any) => p.roleKey)).toEqual([
            'power_1',
            'power_2'
        ]);
    });
    it('removePart drops the row and isPicked reflects state', () => {
        const s = useVirtualDeviceDraftStore();
        s.addPart(cand());
        expect(s.isPicked(cand())).toBe(true);
        s.removePart('power_1');
        expect(s.pickedParts.length).toBe(0);
        expect(s.isPicked(cand())).toBe(false);
    });
});

describe('virtualDeviceTemplates — source suggestions', () => {
    it('uses role component metadata before loose text matching', () => {
        expect(
            roleMatchesCandidate(
                {
                    roleKey: 'door',
                    label: 'Door',
                    valueType: 'boolean',
                    historyMode: 'linked',
                    metadata: {componentType: 'garage_door'}
                },
                cand({
                    componentKey: 'bthomesensor:12',
                    componentType: 'garage_door'
                })
            )
        ).toBe(true);
        expect(
            roleMatchesCandidate(
                {
                    roleKey: 'door',
                    label: 'Door',
                    valueType: 'boolean',
                    historyMode: 'linked',
                    metadata: {componentType: 'garage_door'}
                },
                cand({
                    componentKey: 'switch:0',
                    componentType: 'switch'
                })
            )
        ).toBe(false);
    });
});
