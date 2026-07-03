// The single device-RPC passthrough helper: validate → resolve device →
// wrap + send. One home for the thin "Shelly firmware RPC forwarded to the
// device" shape so every wrapper looks identical. Distinct from Commander
// (dispatch to components), the MessageHandler relay (raw client→device), and
// device.sendRPC (transport). Lives at model/ level so component imports
// resolve it before ./Component and avoid the base-class import cycle.

import {validateOrThrow} from '../rpc/validateOrThrow';
import type {JsonSchema} from '../types/api/_schema';
import {getDeviceOrThrow, wrapDeviceRpc} from './deviceAdminRpc';

export interface PassthroughSpec<P extends {shellyID: string}> {
    namespace: string;
    method: string;
    paramsSchema: JsonSchema;
    // Device payload from validated params. Defaults to params minus shellyID.
    payload?: (v: P) => Record<string, unknown>;
}

function stripShellyID(v: Record<string, unknown>): Record<string, unknown> {
    const {shellyID: _omit, ...rest} = v;
    return rest;
}

export function passthroughRpc<P extends {shellyID: string}>(
    params: unknown,
    spec: PassthroughSpec<P>
): Promise<unknown> {
    const v = validateOrThrow<P>(params, spec.paramsSchema);
    const device = getDeviceOrThrow(v.shellyID);
    const fullMethod = `${spec.namespace}.${spec.method}`;
    const payload = spec.payload
        ? spec.payload(v)
        : stripShellyID(v as Record<string, unknown>);
    return wrapDeviceRpc(fullMethod, () => device.sendRPC(fullMethod, payload));
}
