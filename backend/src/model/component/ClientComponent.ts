// Client namespace — per-socket session controls. Currently exposes
// Client.SetSubscription, which narrows the live event feed for THIS socket
// only (no cross-tenant or cross-user effect).

import {canUseAuthenticatedRead} from '../../modules/authz/evaluator';
import type {ConnectionContext} from '../../modules/web/ws/ConnectionContext';
import {
    buildFilterFromParams,
    clearClientSubscription,
    setClientSubscription
} from '../../modules/web/ws/clientSubscriptionRegistry';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    CLIENT_DESCRIBE,
    CLIENT_SET_SUBSCRIPTION_SCHEMA,
    type ClientSetSubscriptionParams
} from '../../types/api/client';
import Component from './Component';

export default class ClientComponent extends Component<any> {
    constructor() {
        super('client', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return CLIENT_DESCRIBE;
    }

    // Authz: socket already passed CLOSE_AUTH_FAILED before reaching here.
    // Filter narrows this socket's own feed only — using ReadOnly so the
    // "Set" prefix doesn't trigger the viewer canWrite() block. No tenant
    // mutation happens here.
    @Component.NoAudit
    @Component.Expose('SetSubscription')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async setSubscription(
        params: unknown,
        _sender: unknown,
        ctx?: ConnectionContext
    ): Promise<{ok: true}> {
        if (!ctx) {
            // HTTP /rpc has no per-socket identity to attach a filter to.
            throw RpcError.InvalidRequest(
                'Client.SetSubscription requires a WebSocket session'
            );
        }
        const v = validateOrThrow<ClientSetSubscriptionParams>(
            params ?? {},
            CLIENT_SET_SUBSCRIPTION_SCHEMA
        );
        // Recheck after the validation await — socket may have closed.
        if (ctx.signal.aborted) {
            throw RpcError.InvalidRequest('socket closed during validation');
        }
        const isEmpty = !v.eventTypes?.length && !v.deviceIds?.length;
        if (isEmpty) {
            clearClientSubscription(ctx.socket);
        } else {
            setClientSubscription(ctx.socket, buildFilterFromParams(v));
        }
        return {ok: true};
    }
}
