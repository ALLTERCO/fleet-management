import RpcError from '../../rpc/RpcError';
import type {DeviceIngressIdentityState} from '../../types/api/deviceIngress';

const ALLOWED_TRANSITIONS: Record<
    DeviceIngressIdentityState,
    readonly DeviceIngressIdentityState[]
> = {
    pending: ['active', 'disabled', 'deleted'],
    active: ['disabled', 'quarantined', 'deleted'],
    disabled: ['active', 'deleted'],
    quarantined: ['active', 'disabled', 'deleted'],
    deleted: []
};

export function assertIdentityTransition(input: {
    from: DeviceIngressIdentityState;
    to: DeviceIngressIdentityState;
}): void {
    if (input.from === input.to) return;
    if (ALLOWED_TRANSITIONS[input.from].includes(input.to)) return;
    throw RpcError.InvalidParams(
        `invalid identity transition ${input.from} -> ${input.to}`
    );
}

export function identityAcceptsConnections(
    state: DeviceIngressIdentityState
): boolean {
    return state === 'active';
}
