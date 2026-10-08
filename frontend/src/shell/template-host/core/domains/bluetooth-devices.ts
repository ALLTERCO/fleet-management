// First-class BLU devices and gateway-child promotion over the generated RPC
// contract. This is the renderer-neutral surface used by core, Vue and React.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

export type FleetBluetoothDeviceDomain = ReturnType<
    typeof createBluetoothDeviceDomain
>;

// Two namespaces, one domain: the BLU inventory is split between the gateway's
// firmware surface (`bthome.*`) and Fleet's own records (`virtualdevice.*`).
type BluetoothMethod = Extract<
    HostMethod,
    `bthome.${string}` | `virtualdevice.bluetooth.${string}`
>;

export function createBluetoothDeviceDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<BluetoothMethod>(access);

    return {
        /** Which devices can act as a BLU gateway. Two `bthome.*` methods sit
         *  on this domain rather than the raw per-device surface, because
         *  they ask about the BLU inventory, not about one device's firmware. */
        listGateways(): Promise<HostResult<'bthome.listgateways'>> {
            return call('bthome.listgateways', {});
        },
        renameGatewayChild(
            params: HostParams<'bthome.device.rename'>
        ): Promise<HostResult<'bthome.device.rename'>> {
            return call('bthome.device.rename', params);
        },
        /** Takes the sensor back out of the gateway's own config, undoing a
         *  pair. The write went to firmware, so nothing else can reverse it. */
        removeGatewayChild(
            params: HostParams<'bthome.device.remove'>
        ): Promise<HostResult<'bthome.device.remove'>> {
            return call('bthome.device.remove', params);
        },
        listCandidates(
            params: HostParams<'virtualdevice.bluetooth.candidate.list'> = {}
        ): Promise<HostResult<'virtualdevice.bluetooth.candidate.list'>> {
            return call('virtualdevice.bluetooth.candidate.list', params);
        },
        promoteFromGateway(
            params: HostParams<'virtualdevice.bluetooth.promotefromgateway'>
        ): Promise<HostResult<'virtualdevice.bluetooth.promotefromgateway'>> {
            return call('virtualdevice.bluetooth.promotefromgateway', params);
        },
        list(
            params: HostParams<'virtualdevice.bluetooth.list'> = {}
        ): Promise<HostResult<'virtualdevice.bluetooth.list'>> {
            return call('virtualdevice.bluetooth.list', params);
        },
        get(
            params: HostParams<'virtualdevice.bluetooth.get'>
        ): Promise<HostResult<'virtualdevice.bluetooth.get'>> {
            return call('virtualdevice.bluetooth.get', params);
        },
        update(
            params: HostParams<'virtualdevice.bluetooth.update'>
        ): Promise<HostResult<'virtualdevice.bluetooth.update'>> {
            return call('virtualdevice.bluetooth.update', params);
        },
        delete(
            params: HostParams<'virtualdevice.bluetooth.delete'>
        ): Promise<HostResult<'virtualdevice.bluetooth.delete'>> {
            return call('virtualdevice.bluetooth.delete', params);
        },
        transport: {
            list(
                params: HostParams<'virtualdevice.bluetooth.transport.list'>
            ): Promise<HostResult<'virtualdevice.bluetooth.transport.list'>> {
                return call('virtualdevice.bluetooth.transport.list', params);
            },
            /** Which gateway a write goes through. The others keep hearing the
             *  device; only this one can talk back. */
            setPrimary(
                params: HostParams<'virtualdevice.bluetooth.transport.setprimary'>
            ): Promise<
                HostResult<'virtualdevice.bluetooth.transport.setprimary'>
            > {
                return call(
                    'virtualdevice.bluetooth.transport.setprimary',
                    params
                );
            }
        },
        key: {
            /** A reference to the stored encryption key, never the key itself. */
            setRef(
                params: HostParams<'virtualdevice.bluetooth.key.setref'>
            ): Promise<HostResult<'virtualdevice.bluetooth.key.setref'>> {
                return call('virtualdevice.bluetooth.key.setref', params);
            },
            /** Encrypted advertisements stop decoding until a key is set again. */
            clear(
                params: HostParams<'virtualdevice.bluetooth.key.clear'>
            ): Promise<HostResult<'virtualdevice.bluetooth.key.clear'>> {
                return call('virtualdevice.bluetooth.key.clear', params);
            }
        },
        image: {
            /** The upload goes to the ticket URL, not through RPC. */
            createUploadTicket(
                params: HostParams<'virtualdevice.bluetooth.image.createuploadticket'>
            ): Promise<
                HostResult<'virtualdevice.bluetooth.image.createuploadticket'>
            > {
                return call(
                    'virtualdevice.bluetooth.image.createuploadticket',
                    params
                );
            }
        }
    };
}
