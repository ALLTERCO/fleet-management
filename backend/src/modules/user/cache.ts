import {createHash} from 'node:crypto';
import {getLogger} from 'log4js';
import {tuning} from '../../config';
import type {user_t} from '../../types';
import {BoundedMap} from '../boundedMap';

const logger = getLogger('user');

// ============================================================================
// USERINFO CACHE
// ============================================================================

interface CachedUserinfo {
    data: Record<string, unknown>;
    fetchedAt: number;
}

// Cache userinfo by token hash (simple in-memory cache)
export const userinfoCache = new Map<string, CachedUserinfo>();

// Cache TTL: 5 minutes
export const USERINFO_CACHE_TTL_MS = 5 * 60 * 1000;

function sweepUserinfoCache(now: number): void {
    let cleaned = 0;
    for (const [key, value] of userinfoCache.entries()) {
        if (now - value.fetchedAt > USERINFO_CACHE_TTL_MS) {
            userinfoCache.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        logger.debug('Cleaned %d expired userinfo cache entries', cleaned);
    }
}

/**
 * SHA-256 hash for cache key — collision-safe across any token volume.
 */
export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/**
 * Invalidate userinfo cache for a specific token.
 * Call this if you know permissions have changed.
 */
export function invalidateUserinfoCache(accessToken: string): void {
    const cacheKey = hashToken(accessToken);
    userinfoCache.delete(cacheKey);
}

/**
 * Clear entire userinfo cache.
 * Useful for admin operations that affect multiple users.
 */
export function clearUserinfoCache(): void {
    userinfoCache.clear();
    logger.info('Userinfo cache cleared');
}

// Positive introspection cache — TTL is min(introspectedUserTtlMs, claims.exp).
interface CachedUser {
    user: user_t;
    expiresAt: number;
}
const introspectedUsers = new Map<string, CachedUser>();

// Bumped on every eviction. cacheUser rejects a write whose captured value is
// stale, so a revoke that evicts mid-introspection can't be re-poisoned.
let evictionGeneration = 0;

export function currentEvictionGeneration(): number {
    return evictionGeneration;
}

export function getCachedUser(token: string): user_t | null {
    const entry = introspectedUsers.get(hashToken(token));
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
        introspectedUsers.delete(hashToken(token));
        return null;
    }
    return entry.user;
}

// Returns false if a concurrent eviction fenced the write off; the caller then
// re-introspects rather than serving stale permissions.
export function cacheUser(
    token: string,
    user: user_t,
    tokenExpEpochSec?: number,
    opts?: {maxTtlMs?: number; evictionGeneration?: number}
): boolean {
    if (
        opts?.evictionGeneration !== undefined &&
        opts.evictionGeneration !== evictionGeneration
    ) {
        return false;
    }
    const now = Date.now();
    const baseTtl = opts?.maxTtlMs ?? tuning.zitadel.introspectedUserTtlMs;
    const ttlExpiry = now + baseTtl;
    const tokenExpiry =
        typeof tokenExpEpochSec === 'number'
            ? tokenExpEpochSec * 1000
            : Number.POSITIVE_INFINITY;
    introspectedUsers.set(hashToken(token), {
        user,
        expiresAt: Math.min(ttlExpiry, tokenExpiry)
    });
    return true;
}

export function evictCachedUser(token: string): void {
    evictionGeneration++;
    introspectedUsers.delete(hashToken(token));
}

// Evict cached entries whose user_t.credentialId matches (revoke fan-out).
export function evictCachedUserByCredentialId(credentialId: string): number {
    evictionGeneration++;
    let removed = 0;
    for (const [hash, entry] of introspectedUsers) {
        if (entry.user.credentialId === credentialId) {
            introspectedUsers.delete(hash);
            removed++;
        }
    }
    return removed;
}

// Evict every cached user_t for this userId — used when a role grant /
// revoke lands so the next request re-introspects instead of serving the
// pre-revoke shape from cache. Matches on user_t.userId (Zitadel sub) so
// password-flow users (no credentialId) are also covered. O(N) over the
// BoundedMap; N is bounded by introspectedUsers' cap, so the linear scan
// is acceptable at sub-millisecond latency for current caps.
export function evictCachedUserByUserId(userId: string): number {
    evictionGeneration++;
    let removed = 0;
    for (const [hash, entry] of introspectedUsers) {
        if (entry.user.userId === userId) {
            introspectedUsers.delete(hash);
            removed++;
        }
    }
    return removed;
}

// SingleFlight — coalesce concurrent introspections for the same token into
// one Zitadel call. Without this, an SPA boot fires N parallel /rpc, each
// races to introspect, and the burst trips Traefik's per-IP login limit.
const inflightIntrospections = new Map<string, Promise<user_t | undefined>>();

export function getInflightIntrospection(
    token: string
): Promise<user_t | undefined> | undefined {
    return inflightIntrospections.get(hashToken(token));
}

export function registerInflightIntrospection(
    token: string,
    promise: Promise<user_t | undefined>
): void {
    const key = hashToken(token);
    inflightIntrospections.set(key, promise);
    // both handlers so a rejection here doesn't fire unhandledRejection.
    const cleanup = () => inflightIntrospections.delete(key);
    promise.then(cleanup, cleanup);
}

function sweepIntrospectedUsers(now: number): void {
    for (const [k, v] of introspectedUsers) {
        if (now >= v.expiresAt) introspectedUsers.delete(k);
    }
}

// Definitive-rejection cache. BoundedMap caps memory between sweeps.
const REJECTED_TOKEN_TTL_MS = 60_000;
const rejectedTokens = new BoundedMap<string, number>({
    maxSize: tuning.zitadel.tokenRejectionCacheMax,
    ttlMs: REJECTED_TOKEN_TTL_MS
});

export function isTokenRejected(token: string): boolean {
    return rejectedTokens.has(hashToken(token));
}

export function markTokenRejected(token: string): void {
    rejectedTokens.set(hashToken(token), Date.now());
}

export function unmarkTokenRejected(token: string): void {
    rejectedTokens.delete(hashToken(token));
}

function sweepRejectedTokens(_now: number): void {
    // BoundedMap purges lazily on read; nothing to do.
}

// ============================================================================
// SEEN-LOGIN TOKEN CACHE
// ============================================================================
// Zitadel token introspection fires on every request and WS message, so
// logLogin() would otherwise emit an audit row for every single call.
// This cache remembers which tokens have already been audited so each
// unique access token produces exactly one "login" row for its lifetime.
// TTL is configured via tuning.zitadel.seenLoginTokenTtlMs; match your Zitadel
// access-token lifetime (+ small margin) so one token = one login row.

const seenLoginTokens = new BoundedMap<string, number>({
    maxSize: tuning.zitadel.seenLoginTokenCacheMax,
    ttlMs: tuning.zitadel.seenLoginTokenTtlMs
});

/** True the first time this token is seen; false on every subsequent call. */
export function claimFirstLogin(token: string): boolean {
    const key = hashToken(token);
    if (seenLoginTokens.has(key)) return false;
    seenLoginTokens.set(key, Date.now());
    return true;
}

function sweepSeenLoginTokens(_now: number): void {
    // BoundedMap purges lazily on read; nothing to do.
}

// One timer sweeps all four token caches. Module load is side-effect-free.
let userCacheSweepTimer: ReturnType<typeof setInterval> | null = null;

export function startUserCacheSweep(): void {
    if (userCacheSweepTimer) return;
    userCacheSweepTimer = setInterval(() => {
        const now = Date.now();
        sweepUserinfoCache(now);
        sweepIntrospectedUsers(now);
        sweepRejectedTokens(now);
        sweepSeenLoginTokens(now);
    }, tuning.zitadel.userCacheSweepIntervalMs);
    userCacheSweepTimer.unref?.();
}

export function stopUserCacheSweep(): void {
    if (!userCacheSweepTimer) return;
    clearInterval(userCacheSweepTimer);
    userCacheSweepTimer = null;
}
