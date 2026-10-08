// Authentication loads the permission shape, so no sync gate ever meets a
// sender that has none and has to guess from the credential's role string.

import {getLogger} from 'log4js';
import type {user_t} from '../../types';
import {applyBoundary, loadCachedEffectiveShape} from '../authz/resolver';
import {tryGetAuthzRuntime} from '../authz/runtimeHandle';

const logger = getLogger('authn');

// Mirrors buildSender so the shape is resolved for the roles the sender holds.
function rolesOf(user: user_t): string[] {
    return [...(user.roles ?? (user.group ? [user.group] : []))];
}

export async function attachEffectiveShape(user: user_t): Promise<user_t> {
    // A scoped token carries its own synthetic shape; never widen it.
    if (user.effectiveShape) return user;
    if (!user.userId || !user.organizationId) return user;
    const runtime = tryGetAuthzRuntime();
    if (!runtime) {
        logger.error(
            'authz runtime missing at login for %s; every gate denies until it initialises',
            user.username
        );
        return user;
    }
    try {
        const shape = await loadCachedEffectiveShape(
            {cache: runtime.cache, db: runtime.db, l1: runtime.l1},
            {
                userId: user.userId,
                tenantId: user.organizationId,
                builtInRoles: rolesOf(user)
            }
        );
        // A scoped credential may only subtract, so narrow before a gate reads it.
        return {
            ...user,
            effectiveShape: applyBoundary(shape, user.credentialBoundary)
        };
    } catch (error) {
        // Fail closed: the caller keeps its identity and loses every grant.
        logger.error(
            'effective shape load failed for %s in %s: %s',
            user.username,
            user.organizationId,
            error
        );
        return user;
    }
}
