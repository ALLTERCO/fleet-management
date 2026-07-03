import type {
    HostParams,
    HostResult
} from '@/shell/template-host/generated/contract';
import {sendRPC} from '@/tools/websocket';

const FM = 'FLEET_MANAGER';

export type DeviceRelationshipsGetParams =
    HostParams<'device.relationships.get'>;
export type DeviceRelationshipsGraph = HostResult<'device.relationships.get'>;
export type DeviceRelationshipsQueryParams =
    HostParams<'device.relationships.query'>;
export type DeviceRelationshipsQueryResult =
    HostResult<'device.relationships.query'>;

export function getDeviceRelationships(
    input: DeviceRelationshipsGetParams
): Promise<DeviceRelationshipsGraph> {
    return sendRPC(FM, 'device.relationships.get', input);
}

export function queryDeviceRelationships(
    input: DeviceRelationshipsQueryParams
): Promise<DeviceRelationshipsQueryResult> {
    return sendRPC(FM, 'device.relationships.query', input);
}
