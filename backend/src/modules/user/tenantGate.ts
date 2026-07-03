// Cross-tenant admin-op gate. Two strictness levels:
//
// assertTargetInTenant — for FM-side ops (PATs, assignments, sessions).
// Any presence is enough:
//   - self
//   - FM-side: assignment / group membership in this tenant
//   - Zitadel resourceOwner equals this tenant (human users)
//   - fleet_organization_id metadata equals this tenant (service users)
//
// assertTargetOwnedByTenant — for destructive Zitadel mutations
// (delete, deactivate, reactivate, profile/email edit, password reset).
// FM-presence is NOT enough: a user from org B granted a persona in org A
// must still only be mutated by an admin of org B (their home org). Only
// the home-org paths (resourceOwner or service-user metadata) count.

import type CommandSender from '../../model/CommandSender';
import RpcError from '../../rpc/RpcError';
import {identityDirectory} from '../identity';
import {userHasPresenceInTenant} from './tokenStore';

async function targetHomeOrgMatches(
    targetUserId: string,
    orgId: string
): Promise<boolean> {
    return identityDirectory.userBelongsToTenant({
        userId: targetUserId,
        tenantId: orgId
    });
}

export async function assertTargetInTenant(
    sender: CommandSender,
    targetUserId: string,
    orgId: string
): Promise<void> {
    if (sender.getUser()?.userId === targetUserId) return;
    if (await userHasPresenceInTenant(orgId, targetUserId)) return;
    if (await targetHomeOrgMatches(targetUserId, orgId)) return;
    throw RpcError.InvalidParams(
        `userId ${targetUserId} is not in this tenant — no FM presence, no Zitadel org match, no service-user tag`
    );
}

export async function assertTargetOwnedByTenant(
    sender: CommandSender,
    targetUserId: string,
    orgId: string
): Promise<void> {
    if (sender.getUser()?.userId === targetUserId) return;
    if (await targetHomeOrgMatches(targetUserId, orgId)) return;
    throw RpcError.InvalidParams(
        `userId ${targetUserId} is not owned by this tenant — only the user's home tenant can perform Zitadel mutations`
    );
}
