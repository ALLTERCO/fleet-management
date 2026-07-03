import {mount} from '@vue/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';

const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({
    sendRPC,
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

import BluetoothIdentifyStep from '@/components/devices/add/BluetoothIdentifyStep.vue';

beforeEach(() => {
    sendRPC.mockReset();
});

describe('BluetoothIdentifyStep — lists candidates from the backend promotion API', () => {
    it('shows the empty-state hint when the gateway has no promotable children', async () => {
        mockCandidateList([]);
        const w = mount(BluetoothIdentifyStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await flush();
        expect(w.text()).toContain(
            'No sensors paired through this gateway yet'
        );
        w.unmount();
    });

    it('renders one row per candidate in component id order', async () => {
        mockCandidateList([
            candidate({componentKey: 'bthomedevice:202', name: 'Hall sensor'}),
            candidate({componentKey: 'bthomedevice:201', name: null})
        ]);
        const w = mount(BluetoothIdentifyStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await flush();
        const rows = w.findAll('.bis__row');
        expect(rows).toHaveLength(2);
        expect(rows[0].attributes('data-id')).toBe('201');
        expect(rows[1].attributes('data-id')).toBe('202');
        w.unmount();
    });

    it('falls back to the product name before the MAC address', async () => {
        mockCandidateList([
            candidate({
                componentKey: 'bthomedevice:200',
                name: null,
                productName: 'Shelly BLU Door/Window',
                bleAddress: 'aa:bb:cc:dd:ee:99'
            })
        ]);
        const w = mount(BluetoothIdentifyStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await flush();
        const input = w.find('input');
        expect(input.element.value).toBe('Shelly BLU Door/Window');
        w.unmount();
    });
});

describe('BluetoothIdentifyStep — renaming sends BTHome.Device.Rename with the right shape', () => {
    it('hides the Save button until the user actually changes the name — no no-op writes', async () => {
        mockCandidateList([candidate({name: 'Hall sensor'})]);
        const w = mount(BluetoothIdentifyStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await flush();
        expect(
            Array.from(w.element.querySelectorAll('button')).some((b) =>
                b.textContent?.includes('Save')
            )
        ).toBe(false);
        w.unmount();
    });

    it('calls BTHome.Device.Rename with shellyID + id + name when Save is clicked', async () => {
        sendRPC.mockImplementation(async (_target, method) =>
            method === 'virtualdevice.bluetooth.candidate.list'
                ? listResponse([candidate({name: 'Hall sensor'})])
                : {success: true}
        );
        const w = mount(BluetoothIdentifyStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await flush();
        await w.find('input').setValue('Plant room sensor');
        await nextTick();
        const saveBtn = Array.from(w.element.querySelectorAll('button')).find(
            (b) => b.textContent?.includes('Save')
        ) as HTMLButtonElement | undefined;
        saveBtn?.click();
        await new Promise((r) => setTimeout(r, 0));
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'bthome.device.rename',
            {
                shellyID: 'shellypro4pm-aabbccdd',
                id: 200,
                name: 'Plant room sensor'
            }
        );
        w.unmount();
    });

    it('surfaces a per-row error when the rename RPC fails — never silent', async () => {
        sendRPC.mockImplementation(async (_target, method) => {
            if (method === 'virtualdevice.bluetooth.candidate.list') {
                return listResponse([candidate({name: 'Hall sensor'})]);
            }
            throw new Error('Auth required');
        });
        const w = mount(BluetoothIdentifyStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await flush();
        await w.find('input').setValue('Plant room sensor');
        await nextTick();
        const saveBtn = Array.from(w.element.querySelectorAll('button')).find(
            (b) => b.textContent?.includes('Save')
        ) as HTMLButtonElement | undefined;
        saveBtn?.click();
        await new Promise((r) => setTimeout(r, 0));
        expect(w.text()).toContain('Auth required');
        w.unmount();
    });
});

describe('BluetoothIdentifyStep — promotion creates a first-class BLU device', () => {
    it('calls PromoteFromGateway and emits the promoted externalId', async () => {
        sendRPC.mockImplementation(async (_target, method) =>
            method === 'virtualdevice.bluetooth.candidate.list'
                ? listResponse([candidate({componentKey: 'bthomedevice:200'})])
                : {externalId: 'blu_aabbccddeeff'}
        );
        const w = mount(BluetoothIdentifyStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await flush();

        const addBtn = Array.from(w.element.querySelectorAll('button')).find(
            (b) => b.textContent?.includes('Add')
        ) as HTMLButtonElement | undefined;
        addBtn?.click();
        await flush();

        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.bluetooth.promotefromgateway',
            {
                gatewayExternalId: 'shellypro4pm-aabbccdd',
                componentKey: 'bthomedevice:200',
                makePrimary: true
            }
        );
        expect(w.emitted('created')?.[0]).toEqual(['blu_aabbccddeeff']);
        w.unmount();
    });

    it('shows Added instead of calling promote again for existing BLU identities', async () => {
        mockCandidateList([
            candidate({
                alreadyPromoted: true,
                bluetoothExternalId: 'blu_aabbccddeeff'
            })
        ]);
        const w = mount(BluetoothIdentifyStep, {
            props: {gatewayId: 'shellypro4pm-aabbccdd'},
            attachTo: document.body
        });
        await flush();

        expect(w.text()).toContain('Added');
        expect(
            Array.from(w.element.querySelectorAll('button')).some(
                (b) => b.textContent?.trim() === 'Add'
            )
        ).toBe(false);
        w.unmount();
    });
});

function mockCandidateList(items: unknown[]): void {
    sendRPC.mockResolvedValue(listResponse(items));
}

function listResponse(items: unknown[]) {
    return {
        items,
        total: items.length,
        limit: 200,
        offset: 0,
        has_more: false
    };
}

function candidate(overrides: Record<string, unknown> = {}) {
    return {
        gatewayDeviceListId: 11,
        gatewayExternalId: 'shellypro4pm-aabbccdd',
        componentKey: 'bthomedevice:200',
        stableId: 'aabbccddeeff',
        bleAddress: 'aa:bb:cc:dd:ee:ff',
        name: 'Window sensor',
        productName: 'Shelly BLU Door/Window',
        modelId: 'SBDW-002C',
        capability: 'event_only',
        components: [],
        alreadyPromoted: false,
        bluetoothExternalId: null,
        ...overrides
    };
}

async function flush(): Promise<void> {
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
}
