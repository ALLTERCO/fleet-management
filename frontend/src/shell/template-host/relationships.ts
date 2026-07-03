import type {HostParams, HostResult} from './generated/contract';
import {callMethod} from './typed';

export type DeviceRelationshipsGetParams =
    HostParams<'device.relationships.get'>;
export type DeviceRelationshipsGraph = HostResult<'device.relationships.get'>;
export type DeviceRelationshipsQueryParams =
    HostParams<'device.relationships.query'>;
export type DeviceRelationshipsQueryResult =
    HostResult<'device.relationships.query'>;

export const relationships = {
    getDeviceGraph(
        input: DeviceRelationshipsGetParams
    ): Promise<DeviceRelationshipsGraph> {
        return callMethod('device.relationships.get', input);
    },
    query(
        input: DeviceRelationshipsQueryParams
    ): Promise<DeviceRelationshipsQueryResult> {
        return callMethod('device.relationships.query', input);
    }
};
