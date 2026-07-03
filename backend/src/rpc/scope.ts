import type CommandSender from '../model/CommandSender';
import {canCrossOrganizationBoundary} from '../modules/authz/evaluator';
import RpcError from './RpcError';

export interface ScopeParams {
    organizationId?: string;
}

/** Resolve org for a scope-aware RPC. Trusted senders must pass it explicitly. */
export function requireOrganizationId(
    sender: CommandSender,
    params?: ScopeParams
): string {
    const requested = params?.organizationId;
    const senderOrg = sender.getOrganizationId();

    if (sender.isTrusted()) {
        if (!requested) throw RpcError.Domain('OrgScopeRequired');
        return requested;
    }

    if (!senderOrg) throw RpcError.Unauthorized();

    if (!requested || requested === senderOrg) return senderOrg;
    // Only super admins may cross organizations. Org admins stay in their own.
    if (canCrossOrganizationBoundary(sender)) return requested;
    throw RpcError.Unauthorized();
}
