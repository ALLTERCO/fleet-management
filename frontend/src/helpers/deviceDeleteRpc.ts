import {
    bluetoothDevices,
    devices,
    virtualDevices
} from '@/shell/template-host';

export interface DeletableFleetDevice {
    id?: number | null;
    shellyID: string;
    source?: string;
}

function isBluetoothDevice(device: DeletableFleetDevice): boolean {
    return device.source === 'bluetooth';
}

function isVirtualDevice(device: DeletableFleetDevice): boolean {
    return device.source === 'virtual';
}

export async function deleteFleetDevice(
    device: DeletableFleetDevice
): Promise<void> {
    if (isBluetoothDevice(device)) {
        await bluetoothDevices.delete({
            externalId: device.shellyID,
            unpairFromGateway: true
        });
        return;
    }
    if (isVirtualDevice(device)) {
        const current = await virtualDevices.get({externalId: device.shellyID});
        await virtualDevices.delete({
            externalId: device.shellyID,
            expectedRevision: current.revision
        });
        return;
    }
    await devices.delete(device.shellyID);
}
