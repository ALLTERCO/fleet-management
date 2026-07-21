// Per-org MCP on/off switch, stored in the org-profile metadata bag (no new
// table). The capability level lives on the key, not here — this is only the
// tenant kill-switch.

import * as log4js from 'log4js';
import {readOrganizationProfile} from '../organizationModel.js';

const logger = log4js.getLogger('mcp-tenant-policy');

export interface McpTenantPolicy {
    enabled?: boolean; // default true
}

export interface EffectiveMcpPolicy {
    enabled: boolean;
}

// When we cannot confirm a tenant's switch (no org, or a cold-cache read
// failure) MCP reads as off — a switch we can't read must read as "no".
const FAIL_CLOSED: EffectiveMcpPolicy = {enabled: false};

export function resolveMcpPolicy(
    tenant: McpTenantPolicy | undefined
): EffectiveMcpPolicy {
    return {enabled: tenant?.enabled !== false};
}

// Pull mcpPolicy out of the profile metadata bag; undefined if absent/malformed.
export function readMcpTenantPolicy(
    metadata: unknown
): McpTenantPolicy | undefined {
    if (!metadata || typeof metadata !== 'object') return undefined;
    const value = (metadata as Record<string, unknown>).mcpPolicy;
    if (!value || typeof value !== 'object') return undefined;
    return value as McpTenantPolicy;
}

type ProfileReader = (
    orgId: string
) => Promise<{metadata: Record<string, unknown>} | null>;

// Short-lived cache of the tenant bag so /mcp isn't a DB read per call, and a
// blip serves the last value.
interface CacheEntry {
    tenant: McpTenantPolicy | undefined;
    exp: number;
}
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

// Drop an org's cached policy so the next read reflects a just-written change
// immediately (no ≤30s TTL wait). Called on Organization.SetProfile — the one
// path that can edit mcpPolicy. Safe under one-process-per-tenant: the writer
// and this cache share the process.
export function invalidateMcpPolicyCache(orgId: string): void {
    cache.delete(orgId);
}

export async function getEffectiveMcpPolicy(
    orgId: string | undefined,
    readProfile: ProfileReader = readOrganizationProfile,
    nowMs: number = Date.now()
): Promise<EffectiveMcpPolicy> {
    // An org is always required; a principal without one gets no MCP.
    if (!orgId) return FAIL_CLOSED;
    const hit = cache.get(orgId);
    if (hit && nowMs < hit.exp) return resolveMcpPolicy(hit.tenant);
    try {
        const profile = await readProfile(orgId);
        const tenant = readMcpTenantPolicy(profile?.metadata);
        cache.set(orgId, {tenant, exp: nowMs + CACHE_TTL_MS});
        return resolveMcpPolicy(tenant);
    } catch (err) {
        // Warm cache: serve the last known switch through the blip. Cold cache:
        // fail closed — we cannot confirm it, so it reads as off. Log loudly.
        logger.warn(
            'mcpPolicy read failed for org %s; serving %s: %s',
            orgId,
            hit ? 'cached switch' : 'fail-closed (no cache)',
            err
        );
        return hit ? resolveMcpPolicy(hit.tenant) : FAIL_CLOSED;
    }
}
