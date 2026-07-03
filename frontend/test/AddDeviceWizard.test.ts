import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick, ref} from 'vue';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    onLocationEvent: vi.fn(() => () => {})
}));

// The Details step (reached in composed/extracted flows) reads the
// locations/tags/groups stores. Stub them to empty lists so the wizard
// can mount that step without live data.
vi.mock('@/stores/locations', () => ({
    useLocationsStore: () => ({locations: {}, fetchLocations: vi.fn()})
}));
vi.mock('@/stores/tags', () => ({
    useTagsStore: () => ({tags: {}, fetchTags: vi.fn()})
}));
vi.mock('@/stores/groups', () => ({
    useGroupsStore: () => ({groups: {}, fetchGroups: vi.fn()})
}));

// Source lane reuses the Waiting Room composable; mock the boundary here.
vi.mock('@/composables/useWaitingRoomList', () => ({
    useWaitingRoomList: () => ({
        devices: ref(null),
        loading: ref(false),
        error: ref(null),
        allEntries: ref([]),
        paginatedItems: ref([]),
        selected: ref([]),
        selectedSet: ref(new Set()),
        allSelected: ref(false),
        loadItems: vi.fn(),
        refresh: vi.fn(),
        acceptDevice: vi.fn(),
        rejectDevice: vi.fn(),
        deviceClicked: vi.fn(),
        toggleSelectAll: vi.fn(),
        clearSelection: vi.fn(),
        handleAccept: vi.fn(),
        handleReject: vi.fn(),
        openDetail: vi.fn()
    })
}));

import AddDeviceWizard from '@/components/devices/add/AddDeviceWizard.vue';
import {
    useVirtualDeviceDraftStore,
    type WizardKind
} from '@/stores/virtualDeviceDraftStore';

beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
});

// The kind is chosen in the add-device menu before the wizard is shown, so
// mount hidden and flip `visible` — that transition seeds the draft, exactly
// as it happens when the page toggles the modal open.
async function openWizard(kind: WizardKind) {
    const w = mount(AddDeviceWizard, {
        props: {visible: false, kind},
        attachTo: document.body
    });
    await w.setProps({visible: true});
    await nextTick();
    return w;
}

function findButton(label: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll('button')).find(
        (b) => b.textContent?.trim().startsWith(label)
    );
}

describe('AddDeviceWizard — opens directly on the chosen kind first step', () => {
    it('seeds the draft with the chosen kind and lands on the real first step', async () => {
        const w = await openWizard('physical');
        const draft = useVirtualDeviceDraftStore();
        expect(draft.kind).toBe('physical');
        // Physical opens straight onto the source step; no in-wizard kind step.
        expect(document.body.querySelector('.rss')).not.toBeNull();
        w.unmount();
    });

    it('opens Bluetooth on the gateway step', async () => {
        const w = await openWizard('bluetooth');
        expect(useVirtualDeviceDraftStore().kind).toBe('bluetooth');
        expect(document.body.querySelector('.bgs')).not.toBeNull();
        w.unmount();
    });

    it('opens Custom on the template step', async () => {
        const w = await openWizard('composed');
        expect(useVirtualDeviceDraftStore().kind).toBe('composed');
        expect(document.body.querySelector('.vts')).not.toBeNull();
        w.unmount();
    });

    it('keeps the physical source step single-column with no unused preview rail', async () => {
        const w = await openWizard('physical');
        expect(document.body.querySelector('.rss')).not.toBeNull();
        expect(document.body.querySelector('.adw__preview')).toBeNull();
        w.unmount();
    });
});

// A minimal source candidate so addPart() satisfies the parts-step gate.
const FAKE_CANDIDATE = {
    deviceExternalId: 'dev-1',
    deviceName: 'Garage',
    componentKey: 'switch:0',
    componentType: 'switch',
    dynamicCategory: null,
    writable: true
} as const;

describe('AddDeviceWizard — Next/Back navigation', () => {
    it('gates the template step — Next stays hidden until a template is chosen', async () => {
        const w = await openWizard('composed');
        expect(findButton('Next')).toBeUndefined();

        const draft = useVirtualDeviceDraftStore();
        draft.selectProfile(null);
        await nextTick();
        expect(findButton('Next')).toBeDefined();
        w.unmount();
    });

    it('advances from parts to the terminal Details step once a part is picked', async () => {
        const w = await openWizard('composed');
        const draft = useVirtualDeviceDraftStore();
        draft.selectProfile(null);
        await nextTick();
        findButton('Next')?.click();
        await nextTick();
        await nextTick();
        draft.addPart(FAKE_CANDIDATE);
        await nextTick();
        findButton('Next')?.click();
        await nextTick();
        await nextTick();
        // Details is terminal: its panel shows and the footer offers Save.
        expect(document.body.querySelector('.dds')).not.toBeNull();
        expect(findButton('Save device')).toBeDefined();
        w.unmount();
    });

    it('Back returns to the parts step without losing the kind selection', async () => {
        const w = await openWizard('composed');
        const draft = useVirtualDeviceDraftStore();
        draft.selectProfile(null);
        await nextTick();
        findButton('Next')?.click();
        await nextTick();
        await nextTick();
        draft.addPart(FAKE_CANDIDATE);
        await nextTick();
        findButton('Next')?.click();
        await nextTick();
        await nextTick();
        findButton('Back')?.click();
        await nextTick();
        expect(draft.kind).toBe('composed');
        expect(document.body.querySelector('.pps')).not.toBeNull();
        w.unmount();
    });
});

describe('AddDeviceWizard — open/close lifecycle resets the draft', () => {
    it('clears any lingering draft state when the wizard is reopened — second run starts fresh', async () => {
        const w = mount(AddDeviceWizard, {
            props: {visible: true},
            attachTo: document.body
        });
        const draft = useVirtualDeviceDraftStore();
        draft.setKind('composed');
        draft.details.name = 'should not survive';
        await w.setProps({visible: false});
        await w.setProps({visible: true});
        await nextTick();
        expect(draft.kind).toBeNull();
        expect(draft.details.name).toBe('');
        w.unmount();
    });

    it('emits close when the user clicks Cancel — parent owns visibility', async () => {
        const w = await openWizard('composed');
        findButton('Cancel')?.click();
        await nextTick();
        expect(w.emitted('close')).toBeDefined();
        w.unmount();
    });
});
