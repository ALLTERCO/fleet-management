import {beforeEach, describe, expect, it, vi} from 'vitest';

const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({sendRPC}));

import {
    bluetoothDevices,
    createHostDomain,
    devices,
    relationships,
    virtualDevices
} from '@/shell/template-host';

beforeEach(() => {
    sendRPC.mockReset();
});

describe('@host relationships domain', () => {
    it('reads one device graph through the relationship contract', async () => {
        sendRPC.mockResolvedValue({nodes: [], edges: [], summaries: []});
        await relationships.getDeviceGraph({
            shellyID: 'shelly-1',
            depth: 1
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'device.relationships.get',
            {shellyID: 'shelly-1', depth: 1}
        );
    });

    it('queries relationship graphs through the paged contract', async () => {
        sendRPC.mockResolvedValue({items: [], total: 0, has_more: false});
        await relationships.query({limit: 10, offset: 0});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'device.relationships.query',
            {limit: 10, offset: 0}
        );
    });
});

describe('@host virtualDevices domain', () => {
    it('creates composed devices through the virtual-device wrapper', async () => {
        sendRPC.mockResolvedValue({externalId: 'vdev_1'});
        await virtualDevices.create({
            kind: 'composed',
            name: 'Boiler',
            typeKey: 'boiler'
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.create',
            {kind: 'composed', name: 'Boiler', typeKey: 'boiler'}
        );
    });

    it('lists source candidates behind the host domain', async () => {
        sendRPC.mockResolvedValue({items: [], total: 0, has_more: false});
        await virtualDevices.bindings.listSources({roleKey: 'temperature'});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.binding.listsources',
            {roleKey: 'temperature'}
        );
    });

    it('exposes manifests through the generated contract', async () => {
        sendRPC.mockResolvedValue({valid: true, errors: []});
        const manifest = {
            apiVersion: '1',
            kind: 'VirtualDeviceBundle' as const,
            spec: {}
        };
        await virtualDevices.manifest.validate({manifest});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.manifest.validate',
            {manifest}
        );
    });
});

describe('@host bluetoothDevices domain', () => {
    it('lists promotion candidates through the BLU candidate contract', async () => {
        sendRPC.mockResolvedValue({items: [], total: 0, has_more: false});
        await bluetoothDevices.listCandidates({
            gatewayExternalId: 'gateway-1'
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.bluetooth.candidate.list',
            {gatewayExternalId: 'gateway-1'}
        );
    });

    it('uses generated contract calls for first-class BLU listing', async () => {
        sendRPC.mockResolvedValue({items: [], total: 0, has_more: false});
        await bluetoothDevices.list({limit: 20});
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.bluetooth.list',
            {limit: 20}
        );
    });

    it('renames gateway children through the BTHome helper', async () => {
        sendRPC.mockResolvedValue({success: true});
        await bluetoothDevices.renameGatewayChild({
            shellyID: 'gateway-1',
            id: 201,
            name: 'Window'
        });
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'bthome.device.rename',
            {shellyID: 'gateway-1', id: 201, name: 'Window'}
        );
    });
});

describe('@host devices domain', () => {
    it('sets a device catalog kind through the Host SDK', async () => {
        sendRPC.mockResolvedValue({shellyID: 'd1', kind: 'solar_array'});

        await devices.setKind({shellyID: 'd1', kind: 'solar_array'});

        expect(sendRPC).toHaveBeenCalledWith('FLEET_MANAGER', 'device.setkind', {
            shellyID: 'd1',
            kind: 'solar_array'
        });
    });

    it('clears a device catalog kind when kind is null', async () => {
        sendRPC.mockResolvedValue({shellyID: 'd1', kind: null});

        await devices.setKind({shellyID: 'd1', kind: null});

        expect(sendRPC).toHaveBeenCalledWith('FLEET_MANAGER', 'device.setkind', {
            shellyID: 'd1',
            kind: null
        });
    });
});

describe('@host typed domain factory', () => {
    it('routes typed calls through the generated method name', async () => {
        sendRPC.mockResolvedValue({items: [], total: 0, has_more: false});
        const device = createHostDomain('device');

        await device.callTyped('device.list', {limit: 5});

        expect(sendRPC).toHaveBeenCalledWith('FLEET_MANAGER', 'device.list', {
            limit: 5
        });
    });
});
