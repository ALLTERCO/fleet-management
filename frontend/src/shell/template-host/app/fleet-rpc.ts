// The RPC half of the Fleet transport, split out so the legacy `@host/api`
// surface can bind to it without the subscription machinery.

import {sendRPC} from '@/tools/websocket';
import type {FleetRpcTransport} from '../core/transport';

/** Every Host SDK call addresses the Fleet Manager, never a device directly. */
export const FLEET_RPC_DESTINATION = 'FLEET_MANAGER';

export const fleetRpcTransport: FleetRpcTransport = {
    call<TResult>(method: string, params: object): Promise<TResult> {
        return sendRPC<TResult>(FLEET_RPC_DESTINATION, method, params);
    }
};
