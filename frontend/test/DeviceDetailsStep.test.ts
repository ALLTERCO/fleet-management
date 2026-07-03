import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {nextTick} from 'vue';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    onLocationEvent: vi.fn(() => () => {})
}));

// The rewritten step reads the locations/tags/groups stores for its
// dropdowns. Stub them to empty lists so mounting needs no live data.
vi.mock('@/stores/locations', () => ({
    useLocationsStore: () => ({
        locations: {},
        fetchLocations: vi.fn()
    })
}));
vi.mock('@/stores/tags', () => ({
    useTagsStore: () => ({
        tags: {},
        fetchTags: vi.fn()
    })
}));
vi.mock('@/stores/groups', () => ({
    useGroupsStore: () => ({
        groups: {},
        fetchGroups: vi.fn()
    })
}));

import DeviceDetailsStep from '@/components/devices/add/DeviceDetailsStep.vue';
import {useVirtualDeviceDraftStore} from '@/stores/virtualDeviceDraftStore';

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('DeviceDetailsStep — two-way binding with the draft store', () => {
    it('writes the typed name back to the draft so other steps see it', async () => {
        const w = mount(DeviceDetailsStep, {attachTo: document.body});
        const draft = useVirtualDeviceDraftStore();
        const nameInput = w.find('input[type="text"], input:not([type])');
        await nameInput.setValue('Plant room fireplace');
        expect(draft.details.name).toBe('Plant room fireplace');
        w.unmount();
    });

    it('writes the chosen category back to the draft when a label is selected', async () => {
        const w = mount(DeviceDetailsStep, {attachTo: document.body});
        const draft = useVirtualDeviceDraftStore();
        // The Category Dropdown is the first one in the form; the step maps
        // its human label back to the storage key.
        const dropdown = w.findAllComponents({name: 'Dropdown'})[0];
        dropdown.vm.$emit('selected', 'Climate', 2);
        expect(draft.details.categoryKey).toBe('climate');
        dropdown.vm.$emit('selected', '— None —', 0);
        expect(draft.details.categoryKey).toBe(null);
        w.unmount();
    });
});

describe('DeviceDetailsStep — empty-name guard', () => {
    it('keeps the form silent at first render so users do not see an error before typing', () => {
        const w = mount(DeviceDetailsStep, {attachTo: document.body});
        expect(w.text()).not.toContain('Cannot be blank');
        w.unmount();
    });
});

describe('DeviceDetailsStep — decoration picker', () => {
    it('opens the asset picker from the preview card', async () => {
        const w = mount(DeviceDetailsStep, {attachTo: document.body});
        await w
            .find('button[aria-label="Pick device icon or image"]')
            .trigger('click');
        expect(w.findComponent({name: 'AssetPickerModal'}).props('visible')).toBe(
            true
        );
        w.unmount();
    });

    it('stores bundled device pictures as a visual image model', async () => {
        const w = mount(DeviceDetailsStep, {attachTo: document.body});
        const draft = useVirtualDeviceDraftStore();
        w.findComponent({name: 'AssetPickerModal'}).vm.$emit(
            'select-device-picture',
            {model: 'SBDW-002C', label: 'Door Window', url: '/images/devices/SBDW-002C.png'}
        );
        await nextTick();
        expect(draft.details.imageAssetId).toBe(null);
        expect(draft.details.visual).toMatchObject({imageModel: 'SBDW-002C'});
        w.unmount();
    });
});

describe('DeviceDetailsStep — normal device preview', () => {
    it('renders the same device and entity cards used by normal devices', async () => {
        const draft = useVirtualDeviceDraftStore();
        draft.setKind('composed');
        draft.selectProfile({
            id: 'profile-1',
            organizationId: null,
            key: 'garage_door',
            name: 'Garage door',
            version: 1,
            roles: [
                {
                    roleKey: 'door',
                    label: 'Door',
                    valueType: 'boolean',
                    historyMode: 'linked',
                    required: true,
                    writable: false,
                    metadata: {
                        entityType: 'bthomesensor',
                        componentType: 'garage_door',
                        objName: 'garage_door',
                        sensorType: 'binary_sensor'
                    }
                }
            ],
            metadata: {
                categoryKey: 'safety',
                defaultVisual: {icon: 'fas fa-warehouse', accent: 'switch'}
            }
        });
        draft.details.name = 'Hallway Garage Door';
        draft.bindRole('door', {
            deviceExternalId: 'blu_garage',
            componentKey: 'bthomesensor:200'
        });

        const w = mount(DeviceDetailsStep, {attachTo: document.body});
        await nextTick();

        expect(w.find('.dc').exists()).toBe(true);
        expect(w.find('.widget-card').exists()).toBe(true);
        expect(w.text()).toContain('Hallway Garage Door');
        expect(w.text()).toContain('Door');
        w.unmount();
    });
});
