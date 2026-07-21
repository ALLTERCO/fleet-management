// Zitadel session + auth-method + instance ops.
// All Zitadel session APIs are untenanted — gate cross-tenant access here:
//   - global listing (no userId): provider support only
//   - per-user calls: target must belong to sender's tenant
//   - DeleteSession: provider support only (cross-tenant kill);
//     tenant admins off-board via DeactivateUser + RevokeAllUserPATs

import type CommandSender from '../../model/CommandSender';
import RpcError from '../../rpc/RpcError';
import * as AuditLogger from '../AuditLogger';
import {canCrossOrganizationBoundary} from '../authz/evaluator';
import {zitadelService} from '../zitadel';
import {assertTargetInTenant} from './tenantGate';
import {ensureZitadelManagement, requireString} from './validation';

export async function getInstanceInfo() {
    ensureZitadelManagement();
    return await zitadelService.getInstanceInfo();
}

export async function listSessions(
    params: {userId?: string},
    sender: CommandSender
) {
    ensureZitadelManagement();
    if (!params?.userId) {
        if (!canCrossOrganizationBoundary(sender))
            throw RpcError.Unauthorized();
    } else {
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        await assertTargetInTenant(sender, params.userId, orgId);
    }
    const items = await zitadelService.listSessions(params?.userId);
    return {
        items,
        total: items.length,
        limit: 0,
        offset: 0,
        has_more: false
    };
}

export async function deleteSession(
    params: {sessionId: string},
    sender: CommandSender
) {
    requireString('sessionId', params.sessionId);
    ensureZitadelManagement();
    if (!canCrossOrganizationBoundary(sender)) throw RpcError.Unauthorized();
    await zitadelService.deleteSession(params.sessionId);
    AuditLogger.logRpc({
        username: sender.getUser()?.username ?? 'admin',
        actorUserId: sender.getUserId(),
        method: 'User.DeleteSession',
        params: {sessionId: params.sessionId},
        organizationId: sender.getOrganizationId(),
        ipAddress: sender.getSourceIp()
    });
    return {success: true};
}

export async function getAuthMethods(
    params: {userId: string},
    sender: CommandSender
) {
    requireString('userId', params.userId);
    ensureZitadelManagement();
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    await assertTargetInTenant(sender, params.userId, orgId);
    const [methodTypes, passkeys, idpLinks] = await Promise.all([
        zitadelService.listAuthenticationMethodTypes(params.userId),
        zitadelService.listPasskeys(params.userId),
        zitadelService.listIDPLinks(params.userId)
    ]);
    return {
        methodTypes: methodTypes.authMethodTypes,
        passkeys,
        idpLinks
    };
}
