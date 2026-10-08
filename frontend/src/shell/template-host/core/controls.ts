import {createFleetSdkError} from './errors';
import type {ExternalStore} from './external-store';
import type {
    DeviceControlCapabilities,
    DeviceControlRequest,
    FleetDevices,
    FleetPermissions
} from './types';

export const FLEET_CONTROL_NOT_PERMITTED = 'FleetControlNotPermitted';
export const FLEET_CONTROL_NOT_SUPPORTED = 'FleetControlNotSupported';
export const FLEET_CONTROL_INVALID_REQUEST = 'FleetControlInvalidRequest';

export type DeviceControlSubmitter = (
    request: DeviceControlRequest
) => Promise<void>;

export type FleetControls = {
    capabilities(shellyID: string): Promise<DeviceControlCapabilities>;
    submit(request: DeviceControlRequest): Promise<void>;
};

function supports(
    capabilities: DeviceControlCapabilities,
    request: DeviceControlRequest
): boolean {
    return capabilities[request.kind]?.includes(request.id) ?? false;
}

function validate(request: DeviceControlRequest): void {
    if (
        request.kind === 'light' &&
        request.on === undefined &&
        request.brightness === undefined
    ) {
        throw createFleetSdkError(
            FLEET_CONTROL_INVALID_REQUEST,
            'A light command needs on or brightness'
        );
    }
    if (
        request.kind === 'light' &&
        request.brightness !== undefined &&
        (request.brightness < 0 || request.brightness > 100)
    ) {
        throw createFleetSdkError(
            FLEET_CONTROL_INVALID_REQUEST,
            'Brightness must be between 0 and 100'
        );
    }
    if (
        request.kind === 'cover' &&
        request.action === 'position' &&
        (request.position === undefined ||
            request.position < 0 ||
            request.position > 100)
    ) {
        throw createFleetSdkError(
            FLEET_CONTROL_INVALID_REQUEST,
            'Cover position must be between 0 and 100'
        );
    }
}

export function createControlDomain(
    devices: FleetDevices,
    permissions: ExternalStore<FleetPermissions>,
    submitter: DeviceControlSubmitter
): FleetControls {
    const capabilities = async (
        shellyID: string
    ): Promise<DeviceControlCapabilities> =>
        (await devices.get(shellyID)).controlCapabilities ?? {};

    return {
        capabilities,
        async submit(request) {
            validate(request);
            if (
                !permissions
                    .getSnapshot()
                    .can('devices', 'execute', request.shellyID)
            ) {
                throw createFleetSdkError(
                    FLEET_CONTROL_NOT_PERMITTED,
                    'You do not have permission to control this device'
                );
            }
            const supportedControls = await capabilities(request.shellyID);
            if (!supports(supportedControls, request)) {
                throw createFleetSdkError(
                    FLEET_CONTROL_NOT_SUPPORTED,
                    `${request.kind}:${request.id} is not present on this device`
                );
            }
            await submitter(request);
        }
    };
}
