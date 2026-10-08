import RpcError from '../../rpc/RpcError';
import type {DeviceIngressCredentialState} from '../../types/api/deviceIngress';

const ALLOWED_TRANSITIONS: Record<
    DeviceIngressCredentialState,
    readonly DeviceIngressCredentialState[]
> = {
    active: ['pending', 'expired', 'revoked', 'superseded'],
    // A finalize now supersedes every older active-or-pending key of the
    // identity, not only the active one (see activatePendingCredential).
    pending: ['active', 'expired', 'revoked', 'superseded'],
    expired: ['revoked'],
    revoked: [],
    superseded: ['revoked']
};

export function assertCredentialTransition(input: {
    from: DeviceIngressCredentialState;
    to: DeviceIngressCredentialState;
}): void {
    if (input.from === input.to) return;
    if (ALLOWED_TRANSITIONS[input.from].includes(input.to)) return;
    throw RpcError.InvalidParams(
        `invalid credential transition ${input.from} -> ${input.to}`
    );
}

export function credentialAcceptsHandshake(
    state: DeviceIngressCredentialState
): boolean {
    return state === 'active' || state === 'pending';
}

export function credentialRequiresRotation(
    state: DeviceIngressCredentialState
): boolean {
    return state === 'expired' || state === 'superseded';
}
