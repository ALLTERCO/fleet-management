// Authz module — env-driven config. Env file is the single source of truth.

import {envIntRequired, envStrRequired} from '../../config/envReader';
import {fmClientOrgId} from '../../config/zitadel';

export interface AuthzConfig {
    redisUrl: string;
    l1MaxEntries: number;
    l1TtlSeconds: number;
    l2TtlSeconds: number;
    keyPrefix: string;
    pubsubChannelPrefix: string;
    // Set when this process is pinned to a single tenant (shared multi-tenant
    // deploy). Narrows the invalidation (p)subscribe to this tenant's channel so
    // a peer tenant cannot publish forged invalidations to us. Undefined = a
    // single process serving many orgs, which subscribes to all tenants.
    pinnedTenantId?: string;
    groupDepthMax: number;
    unusedThresholdDays: number;
}

/** (P)subscribe pattern for authz invalidations. A tenant-pinned process (shared
 *  multi-tenant deploy) subscribes to ONLY its own tenant's channel so a peer
 *  tenant holding Redis creds cannot publish forged invalidations to it; an
 *  unpinned process serving many orgs keeps the all-tenant pattern. */
export function authzInvalidationPattern(cfg: AuthzConfig): string {
    return cfg.pinnedTenantId
        ? `${cfg.pubsubChannelPrefix}:${cfg.pinnedTenantId}`
        : `${cfg.pubsubChannelPrefix}:*`;
}

export function loadAuthzConfig(): AuthzConfig {
    return {
        redisUrl: envStrRequired('FM_REDIS_URL'),
        l1MaxEntries: envIntRequired('FM_AUTHZ_L1_MAX_ENTRIES'),
        l1TtlSeconds: envIntRequired('FM_AUTHZ_L1_TTL_SECONDS'),
        l2TtlSeconds: envIntRequired('FM_AUTHZ_L2_TTL_SECONDS'),
        keyPrefix: envStrRequired('FM_AUTHZ_REDIS_KEY_PREFIX'),
        pubsubChannelPrefix: envStrRequired('FM_AUTHZ_PUBSUB_CHANNEL_PREFIX'),
        pinnedTenantId: fmClientOrgId(),
        groupDepthMax: envIntRequired('FM_AUTHZ_GROUP_DEPTH_MAX'),
        unusedThresholdDays: envIntRequired('FM_AUTHZ_UNUSED_THRESHOLD_DAYS')
    };
}
