import type {HostParams, HostResult} from './generated/contract';
import {callMethod} from './typed';

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

export const bluetoothDevices = {
    listGateways(): Promise<HostResult<'bthome.listgateways'>> {
        return callMethod('bthome.listgateways', {});
    },
    renameGatewayChild(
        input: HostParams<'bthome.device.rename'>
    ): Promise<HostResult<'bthome.device.rename'>> {
        return callMethod('bthome.device.rename', input);
    },
    listCandidates(
        input: HostParams<'virtualdevice.bluetooth.candidate.list'> = {}
    ): Promise<HostResult<'virtualdevice.bluetooth.candidate.list'>> {
        return callMethod('virtualdevice.bluetooth.candidate.list', input);
    },
    promoteFromGateway(
        input: HostParams<'virtualdevice.bluetooth.promotefromgateway'>
    ): Promise<HostResult<'virtualdevice.bluetooth.promotefromgateway'>> {
        return callMethod('virtualdevice.bluetooth.promotefromgateway', input);
    },
    delete(
        input: HostParams<'virtualdevice.bluetooth.delete'>
    ): Promise<HostResult<'virtualdevice.bluetooth.delete'>> {
        return callMethod('virtualdevice.bluetooth.delete', input);
    },
    createImageUploadTicket(
        input: HostParams<'virtualdevice.bluetooth.image.createuploadticket'>
    ): Promise<HostResult<'virtualdevice.bluetooth.image.createuploadticket'>> {
        return callMethod(
            'virtualdevice.bluetooth.image.createuploadticket',
            input
        );
    },
    list(input: BluetoothListParams = {}): Promise<BluetoothListResult> {
        return callMethod('virtualdevice.bluetooth.list', input);
    },
    get(input: BluetoothGetParams): Promise<BluetoothGetResult> {
        return callMethod('virtualdevice.bluetooth.get', input);
    },
    update(input: BluetoothUpdateParams): Promise<BluetoothUpdateResult> {
        return callMethod('virtualdevice.bluetooth.update', input);
    },
    listTransports(
        input: BluetoothTransportListParams
    ): Promise<BluetoothTransportListResult> {
        return callMethod('virtualdevice.bluetooth.transport.list', input);
    },
    setPrimaryTransport(
        input: BluetoothTransportSetPrimaryParams
    ): Promise<BluetoothTransportSetPrimaryResult> {
        return callMethod(
            'virtualdevice.bluetooth.transport.setprimary',
            input
        );
    }
};
