// Re-bound to the Fleet transport. The two calls live on the device domain,
// where the rest of the device surface is; this file only keeps the older
// names pointing at them, so the same RPC has one home.

import {hostRpcAccess} from './api';
import {createDeviceDomain} from './core/domains/devices';
import type {HostParams, HostResult} from './generated/contract';

export type DeviceRelationshipsGetParams =
    HostParams<'device.relationships.get'>;
export type DeviceRelationshipsGraph = HostResult<'device.relationships.get'>;
export type DeviceRelationshipsQueryParams =
    HostParams<'device.relationships.query'>;
export type DeviceRelationshipsQueryResult =
    HostResult<'device.relationships.query'>;

const devices = createDeviceDomain(hostRpcAccess);

export const relationships = {
    /** Kept under the old name; `fleet.devices.relationships.get` is the same call. */
    getDeviceGraph: devices.relationships.get,
    query: devices.relationships.query
};
