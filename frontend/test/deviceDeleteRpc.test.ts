import {beforeEach, describe, expect, it, vi} from 'vitest';

const deleteBluetooth = vi.hoisted(() => vi.fn());
const deleteDevice = vi.hoisted(() => vi.fn());
const deleteVirtual = vi.hoisted(() => vi.fn());
const getVirtual = vi.hoisted(() => vi.fn());

vi.mock('@/shell/template-host', () => ({
    bluetoothDevices: {delete: deleteBluetooth},
    devices: {delete: deleteDevice},
    virtualDevices: {delete: deleteVirtual, get: getVirtual}
}));

import {deleteFleetDevice} from '@/helpers/deviceDeleteRpc';

beforeEach(() => {
    deleteBluetooth.mockReset();
    deleteDevice.mockReset();
    deleteVirtual.mockReset();
    getVirtual.mockReset();
    getVirtual.mockResolvedValue({revision: 42});
});

describe('deleteFleetDevice', () => {
    it('deletes physical devices through the host SDK', async () => {
        await deleteFleetDevice({id: 7, shellyID: 'shelly-1'});
        expect(deleteDevice).toHaveBeenCalledWith('shelly-1');
    });

    it('deletes virtual devices through the host SDK', async () => {
        await deleteFleetDevice({shellyID: 'vdev_1', source: 'virtual'});
        expect(getVirtual).toHaveBeenCalledWith({externalId: 'vdev_1'});
        expect(deleteVirtual).toHaveBeenCalledWith({
            externalId: 'vdev_1',
            expectedRevision: 42
        });
    });

    it('deletes Bluetooth children through the host SDK', async () => {
        await deleteFleetDevice({shellyID: 'blu_1', source: 'bluetooth'});
        expect(deleteBluetooth).toHaveBeenCalledWith({
            externalId: 'blu_1',
            unpairFromGateway: true
        });
    });
});
