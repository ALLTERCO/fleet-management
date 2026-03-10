import {getLogger} from 'log4js';

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

// Clean up expired cache entries periodically (every 10 minutes)
setInterval(
    () => {
        const now = Date.now();
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
    },
    10 * 60 * 1000
);

/**
 * Simple hash function for cache key (not cryptographic, just for cache lookup)
 */
export function hashToken(token: string): string {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
        const char = token.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
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
