import {beforeEach, describe, expect, it, vi} from 'vitest';

const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({sendRPC}));

import {
    createBluetoothImageUploadTicket,
    createVirtualDevice,
    createVirtualDeviceImageUploadTicket,
    deleteBluetoothDevice,
    listBindableSources,
    listBluetoothCandidates,
    listVirtualDeviceBindings,
    listVirtualDeviceProfiles,
    previewVirtualDevice,
    promoteBluetoothFromGateway,
    validateVirtualBindings
} from '@/api/virtualDeviceRpc';

beforeEach(() => {
    sendRPC.mockReset();
});

describe('virtualDeviceRpc — every wrapper hits the right method on FLEET_MANAGER', () => {
    it('routes profile listing through virtualdevice.Profile.List with the input params', async () => {
        sendRPC.mockResolvedValue({
            items: [],
            total: 0,
            limit: 0,
            offset: 0,
            has_more: false
        });
        await listVirtualDeviceProfiles({query: 'fire', limit: 50});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Profile.List',
            {query: 'fire', limit: 50}
        );
    });

    it('sends an empty object when profile-list input is omitted so backend uses defaults', async () => {
        sendRPC.mockResolvedValue({
            items: [],
            total: 0,
            limit: 0,
            offset: 0,
            has_more: false
        });
        await listVirtualDeviceProfiles();
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Profile.List',
            {}
        );
    });

    it('forwards bindable-source filters to virtualdevice.Binding.ListSources', async () => {
        sendRPC.mockResolvedValue({
            items: [],
            total: 0,
            limit: 0,
            offset: 0,
            has_more: false
        });
        await listBindableSources({componentType: 'switch', roleKey: 'burner'});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Binding.ListSources',
            {componentType: 'switch', roleKey: 'burner'}
        );
    });

    it('passes draft bindings to validateVirtualBindings exactly as given', async () => {
        sendRPC.mockResolvedValue({valid: true, errors: []});
        const input = {
            externalId: 'vdev_x',
            bindings: [
                {
                    roleKey: 'burner',
                    source: {
                        deviceExternalId: 'shelly-1',
                        componentKey: 'switch:0'
                    }
                }
            ]
        };
        await validateVirtualBindings(input);
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Binding.ValidateDraft',
            input
        );
    });

    it('preview wraps device + bindings under virtualdevice.Draft.Preview', async () => {
        sendRPC.mockResolvedValue({
            device: {},
            bindings: [],
            validation: {valid: true, errors: []}
        });
        await previewVirtualDevice({
            device: {kind: 'composed', name: 'X', typeKey: 'fireplace'},
            bindings: []
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Draft.Preview',
            {
                device: {kind: 'composed', name: 'X', typeKey: 'fireplace'},
                bindings: []
            }
        );
    });

    it('create hits virtualdevice.Create and returns the backend DTO unchanged', async () => {
        const dto = {externalId: 'vdev_x', revision: 1};
        sendRPC.mockResolvedValue(dto);
        const out = await createVirtualDevice({
            kind: 'composed',
            name: 'X',
            typeKey: 'fireplace'
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Create',
            {kind: 'composed', name: 'X', typeKey: 'fireplace'}
        );
        expect(out).toBe(dto);
    });

    it('binding listing routes the externalId through Binding.List', async () => {
        sendRPC.mockResolvedValue({items: []});
        await listVirtualDeviceBindings({externalId: 'vdev_x'});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Binding.List',
            {externalId: 'vdev_x'}
        );
    });

    it('requests virtual-device image upload tickets by externalId', async () => {
        sendRPC.mockResolvedValue({
            uploadTicket: 'ticket-1',
            expiresAt: '2026-06-03T00:00:00.000Z'
        });
        await createVirtualDeviceImageUploadTicket({externalId: 'vdev_x'});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Image.CreateUploadTicket',
            {externalId: 'vdev_x'}
        );
    });

    it('requests Bluetooth image upload tickets by externalId', async () => {
        sendRPC.mockResolvedValue({
            uploadTicket: 'ticket-1',
            expiresAt: '2026-06-03T00:00:00.000Z'
        });
        await createBluetoothImageUploadTicket({externalId: 'blu_x'});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Bluetooth.Image.CreateUploadTicket',
            {externalId: 'blu_x'}
        );
    });

    it('lists Bluetooth promotion candidates for one gateway', async () => {
        sendRPC.mockResolvedValue({
            items: [],
            total: 0,
            limit: 200,
            offset: 0,
            has_more: false
        });
        await listBluetoothCandidates({
            gatewayExternalId: 'shelly-gateway-1',
            limit: 200
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Bluetooth.Candidate.List',
            {gatewayExternalId: 'shelly-gateway-1', limit: 200}
        );
    });

    it('promotes a gateway child through the BLU promotion contract', async () => {
        sendRPC.mockResolvedValue({externalId: 'blu_aabbccddeeff'});
        await promoteBluetoothFromGateway({
            gatewayExternalId: 'shelly-gateway-1',
            componentKey: 'bthomedevice:200',
            makePrimary: true
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Bluetooth.PromoteFromGateway',
            {
                gatewayExternalId: 'shelly-gateway-1',
                componentKey: 'bthomedevice:200',
                makePrimary: true
            }
        );
    });

    it('deletes Bluetooth devices through the BLU delete contract', async () => {
        sendRPC.mockResolvedValue({externalId: 'blu_x', deleted: true});
        await deleteBluetoothDevice({
            externalId: 'blu_x',
            unpairFromGateway: true
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.Bluetooth.Delete',
            {externalId: 'blu_x', unpairFromGateway: true}
        );
    });

    it('lets a network error from sendRPC propagate untouched — callers must surface it', async () => {
        const boom = new Error('ws gone');
        sendRPC.mockRejectedValue(boom);
        await expect(listVirtualDeviceProfiles()).rejects.toBe(boom);
    });
});
