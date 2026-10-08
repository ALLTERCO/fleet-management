// The older names for the BLU surface, pointing at the one implementation.
//
// This file used to be a second, hand-written copy of the core domain: six
// methods with two bodies each, one used by Fleet Manager and one by
// templates. Whoever fixed a bug in one left the other broken. The behaviour
// now lives only in core/domains/bluetooth-devices; the names that differ are
// mapped here, so no call site had to move.

import {hostRpcAccess} from './api';
import {createBluetoothDeviceDomain} from './core/domains/bluetooth-devices';

const domain = createBluetoothDeviceDomain(hostRpcAccess);

export const bluetoothDevices = {
    listGateways: domain.listGateways,
    renameGatewayChild: domain.renameGatewayChild,
    removeGatewayChild: domain.removeGatewayChild,
    listCandidates: domain.listCandidates,
    promoteFromGateway: domain.promoteFromGateway,
    list: domain.list,
    get: domain.get,
    update: domain.update,
    delete: domain.delete,
    // Flat here, nested in core: the core name mirrors the RPC.
    createImageUploadTicket: domain.image.createUploadTicket,
    listTransports: domain.transport.list,
    setPrimaryTransport: domain.transport.setPrimary
};

// Types stay here: they are the published names, derived from the
// contract, and unrelated to which file owns the behaviour.
import type {HostParams, HostResult} from './generated/contract';

export type BTHomeGateway = HostResult<'bthome.listgateways'>['items'][number];
export type BluetoothCandidate =
    HostResult<'virtualdevice.bluetooth.candidate.list'>['items'][number];
export type BluetoothDevice = HostResult<'virtualdevice.bluetooth.get'>;
export type BluetoothTransport =
    HostResult<'virtualdevice.bluetooth.transport.list'>['items'][number];
export type BluetoothListParams = HostParams<'virtualdevice.bluetooth.list'>;
export type BluetoothGetParams = HostParams<'virtualdevice.bluetooth.get'>;
export type BluetoothUpdateParams =
    HostParams<'virtualdevice.bluetooth.update'>;
export type BluetoothTransportListParams =
    HostParams<'virtualdevice.bluetooth.transport.list'>;
export type BluetoothTransportSetPrimaryParams =
    HostParams<'virtualdevice.bluetooth.transport.setprimary'>;
export type BluetoothListResult = HostResult<'virtualdevice.bluetooth.list'>;
export type BluetoothGetResult = HostResult<'virtualdevice.bluetooth.get'>;
export type BluetoothUpdateResult =
    HostResult<'virtualdevice.bluetooth.update'>;
export type BluetoothTransportListResult =
    HostResult<'virtualdevice.bluetooth.transport.list'>;
export type BluetoothTransportSetPrimaryResult =
    HostResult<'virtualdevice.bluetooth.transport.setprimary'>;
