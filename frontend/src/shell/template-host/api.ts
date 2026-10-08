// Legacy `@host` / `@host/api` escape hatches, bound to the Fleet transport.

import {fleetRpcTransport} from './app/fleet-rpc';
import {createRpcAccess} from './core/client';
import {
    type HostApiMethod,
    type HostApiNode,
    toRpcMethod as toCoreRpcMethod
} from './core/rpc-client';

export {DEFAULT_PAGE_SIZE} from './core/pagination';
export type {HostApiMethod, HostApiNode};

// Declared rather than re-exported: check-host-api-coverage.mjs asserts that
// api.ts itself declares the documented escape hatches.
export const toRpcMethod = toCoreRpcMethod;

/** The Host SDK's RPC access, bound to the Fleet application transport. */
export const hostRpcAccess = createRpcAccess(fleetRpcTransport);

export const api: HostApiNode = hostRpcAccess.api;
export const call = hostRpcAccess.call;
export const listAll = hostRpcAccess.listAll;
