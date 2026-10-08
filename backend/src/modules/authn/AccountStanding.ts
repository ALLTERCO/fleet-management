// A person's credentials stop working when the identity provider stops the
// account, even if no Zitadel event reaches Fleet: every recognised person is
// re-checked against an account state cached for at most
// tuning.zitadel.accountStateTtlMs. Zitadel failures propagate (fail closed).

import {getLogger} from 'log4js';
import type {user_t} from '../../types';
import {hasFleetManagerAccess} from '../authz/coarse/AuthContextResolver';
import {hasPlatformAdminAuthority} from '../authz/coarse/PlatformAdminResolver';
import {getDeploymentTopology, identityDirectory} from '../identity';
import {SingleFlight} from '../singleFlight';
import {
    cacheAccountState,
    currentEvictionGeneration,
    getCachedAccountState
} from '../user/cache';
import {userHasPresenceInTenant} from '../user/tokenStore';

const logger = getLogger('authn');

type StandingRefusal = 'account_not_active' | 'no_fleet_access';

const accountStateLoads = new SingleFlight<string, boolean>('account_state');

// Service tokens are deployment secrets, not a person's credential.
function isServicePrincipal(user: user_t): boolean {
    return user.group === 'automation_service';
}

async function loadAccountState(userId: string): Promise<boolean> {
    const evictionGeneration = currentEvictionGeneration();
    const active = await identityDirectory.userAccountActive(userId);
    cacheAccountState(userId, {active, evictionGeneration});
    return active;
}

async function accountActive(userId: string): Promise<boolean> {
    const cached = getCachedAccountState(userId);
    if (cached !== undefined) return cached;
    return accountStateLoads.run(userId, () => loadAccountState(userId));
}

// A Fleet-issued key keeps the admission rule a session gets at sign-in.
async function credentialOwnerHasFleetAccess(input: {
    userId: string;
    user: user_t;
}): Promise<boolean> {
    const tenantId = input.user.organizationId;
    if (!tenantId) return false;
    return hasFleetManagerAccess({
        userId: input.userId,
        tenantId,
        roles: input.user.roles ?? [],
        isPlatformAdmin: () =>
            hasPlatformAdminAuthority({
                userId: input.userId,
                organizationId: tenantId,
                platformOrgId: getDeploymentTopology().platformOrgId,
                identityDirectory
            }),
        hasFineGrainedAccess: (query) =>
            userHasPresenceInTenant(query.tenantId, query.userId)
    });
}

async function standingRefusal(user: user_t): Promise<StandingRefusal | null> {
    const userId = user.userId;
    if (!userId || !(await accountActive(userId))) return 'account_not_active';
    if (
        user.credentialId &&
        !(await credentialOwnerHasFleetAccess({userId, user}))
    ) {
        return 'no_fleet_access';
    }
    return null;
}

/** False when the owner of a recognised credential may no longer use it. */
export async function hasAccountStanding(user: user_t): Promise<boolean> {
    if (isServicePrincipal(user)) return true;
    const refusal = await standingRefusal(user);
    if (refusal === null) return true;
    logger.info(
        'credential refused: user=%s credential=%s reason=%s',
        user.userId ?? 'none',
        user.credentialId ?? 'session',
        refusal
    );
    return false;
}
