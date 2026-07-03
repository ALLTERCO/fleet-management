import type CommandSender from '../../../model/CommandSender';
import RpcError from '../../../rpc/RpcError';
import type {AuthzDecision, AuthzRequest} from '../contracts';
import {AuthzEvaluator} from './AuthzEvaluator';

let defaultEvaluator: AuthzEvaluator | undefined;

export function canPerform(
    sender: CommandSender | undefined,
    request: AuthzRequest
): AuthzDecision {
    return getDefaultEvaluator().canPerform(sender, request);
}

export function canPerformAsync(
    sender: CommandSender | undefined,
    request: AuthzRequest
): Promise<AuthzDecision> {
    return getDefaultEvaluator().canPerformAsync(sender, request);
}

// Throws on a denied decision; 403 for an authenticated caller, else 401.
function orThrowDenied(
    decision: AuthzDecision,
    sender: CommandSender | undefined
): AuthzDecision {
    if (!decision.allowed) {
        throw RpcError.PermissionDenied(sender?.isAuthenticated() ?? false);
    }
    return decision;
}

export function requirePermission(
    sender: CommandSender | undefined,
    request: AuthzRequest
): AuthzDecision {
    return orThrowDenied(canPerform(sender, request), sender);
}

export async function requirePermissionAsync(
    sender: CommandSender | undefined,
    request: AuthzRequest
): Promise<AuthzDecision> {
    return orThrowDenied(await canPerformAsync(sender, request), sender);
}

function getDefaultEvaluator(): AuthzEvaluator {
    defaultEvaluator ??= new AuthzEvaluator();
    return defaultEvaluator;
}
