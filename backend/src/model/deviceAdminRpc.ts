import * as DeviceCollector from '../modules/DeviceCollector';
import {isPlainObject} from '../modules/util/isPlainObject';
import RpcError from '../rpc/RpcError';

// Re-exported from its canonical home so existing device-RPC importers keep
// a single source of truth.
export {isPlainObject};

/**
 * Shared lookup used by every device-namespace RPC wrapper component.
 * Validates the shellyID is a string, then throws DeviceNotFound when
 * the id is unknown — so callers don't each re-implement the same guard.
 */
export function getDeviceOrThrow(shellyID: unknown) {
    if (typeof shellyID !== 'string') {
        throw RpcError.InvalidParams('Expected { shellyID: string }');
    }
    const device = DeviceCollector.getDevice(shellyID);
    if (!device) throw RpcError.DeviceNotFound();
    return device;
}

export async function wrapDeviceRpc<T>(
    label: string,
    fn: () => Promise<T>
): Promise<T> {
    try {
        return await fn();
    } catch (err: unknown) {
        throw RpcError.DeviceFailed(label, err);
    }
}
