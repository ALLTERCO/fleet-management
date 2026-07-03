import RpcError from '../../rpc/RpcError';
import type {
    BluetoothDeleteParams,
    BluetoothDeviceDto,
    BluetoothTransportDto
} from '../../types/api/virtualdevice';
import * as DeviceCollector from '../DeviceCollector';
import {
    getBluetoothDevice,
    listBluetoothTransports
} from './bluetoothRepository';

interface BluetoothGatewayUnpairTarget {
    gatewayExternalId: string;
    method: 'BTHome.DeleteDevice' | 'BluTrv.Delete';
    id: number;
}

interface BluetoothGatewayUnpairDeps {
    getDevice(
        organizationId: string,
        externalId: string
    ): Promise<BluetoothDeviceDto | null>;
    listTransports(
        organizationId: string,
        externalId: string
    ): Promise<{items: BluetoothTransportDto[]}>;
    sendRpc(
        gatewayExternalId: string,
        method: BluetoothGatewayUnpairTarget['method'],
        params: {id: number}
    ): Promise<void>;
}

const defaultDeps: BluetoothGatewayUnpairDeps = {
    getDevice: getBluetoothDevice,
    listTransports: listBluetoothTransports,
    sendRpc: sendGatewayRpc
};

export async function unpairBluetoothFromGateways(
    organizationId: string,
    input: BluetoothDeleteParams,
    ignoreGatewayErrors: boolean,
    deps: BluetoothGatewayUnpairDeps = defaultDeps
): Promise<void> {
    const device = await deps.getDevice(organizationId, input.externalId);
    if (!device) throw RpcError.NotFound('bluetooth_device', input.externalId);
    const transports = await deps.listTransports(
        organizationId,
        input.externalId
    );
    const targets = bluetoothGatewayUnpairTargets(device, transports.items);
    for (const target of targets) {
        await sendUnpairRpc(target, ignoreGatewayErrors, deps);
    }
}

export function bluetoothGatewayUnpairTargets(
    device: BluetoothDeviceDto,
    transports: readonly BluetoothTransportDto[]
): BluetoothGatewayUnpairTarget[] {
    const source = bluetoothGatewayUnpairSource(device);
    if (!source) return [];
    const unique = new Map<string, BluetoothGatewayUnpairTarget>();
    for (const transport of transports) {
        if (transport.mode !== 'bthome_gateway') continue;
        if (!transport.enabled || !transport.shellyDeviceExternalId) continue;
        const target = {
            gatewayExternalId: transport.shellyDeviceExternalId,
            method: source.method,
            id: source.id
        };
        unique.set(
            `${target.gatewayExternalId}:${target.method}:${target.id}`,
            target
        );
    }
    return [...unique.values()];
}

function bluetoothGatewayUnpairSource(
    device: BluetoothDeviceDto
): Pick<BluetoothGatewayUnpairTarget, 'method' | 'id'> | null {
    const trv = device.components.find((component) =>
        component.componentKey.startsWith('blutrv:')
    );
    if (trv) {
        return {method: 'BluTrv.Delete', id: componentId(trv.componentKey)};
    }
    const bthomeDevice = device.components.find((component) =>
        component.componentKey.startsWith('bthomedevice:')
    );
    if (!bthomeDevice) return null;
    return {
        method: 'BTHome.DeleteDevice',
        id: componentId(bthomeDevice.componentKey)
    };
}

function componentId(componentKey: string): number {
    const id = Number.parseInt(componentKey.split(':')[1] ?? '', 10);
    if (!Number.isFinite(id)) {
        throw RpcError.InvalidParams('Invalid Bluetooth source component key', [
            {
                field: 'componentKey',
                error: componentKey,
                code: 'invalid_component_key'
            }
        ]);
    }
    return id;
}

async function sendUnpairRpc(
    target: BluetoothGatewayUnpairTarget,
    ignoreGatewayErrors: boolean,
    deps: BluetoothGatewayUnpairDeps
): Promise<void> {
    try {
        await deps.sendRpc(target.gatewayExternalId, target.method, {
            id: target.id
        });
    } catch (err) {
        if (ignoreGatewayErrors) return;
        throw RpcError.DeviceFailed(
            target.method,
            err,
            target.gatewayExternalId
        );
    }
}

async function sendGatewayRpc(
    gatewayExternalId: string,
    method: BluetoothGatewayUnpairTarget['method'],
    params: {id: number}
): Promise<void> {
    const gateway = DeviceCollector.getDevice(gatewayExternalId);
    if (!gateway) {
        throw RpcError.Unavailable(
            'bluetooth_gateway',
            `${gatewayExternalId} is offline`
        );
    }
    await gateway.sendRPC(method, params);
}
