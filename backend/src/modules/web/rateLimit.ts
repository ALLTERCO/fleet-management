/** Per-user, per-method token-bucket rate limiter for RPC transports. */
import type {NextFunction, Request, Response} from 'express';
import * as log4js from 'log4js';
import type {TuningConfig} from '../../config';
import RpcError from '../../rpc/RpcError';
import {BoundedMap} from '../boundedMap';

// AuditLogger eagerly loads tuning at import; require() lazily here so
// callers that set env vars before importing rateLimit (tests) still win.
type AuditLoggerSurface = typeof import('../AuditLogger');
let _audit: AuditLoggerSurface | undefined;
function audit(): AuditLoggerSurface {
    if (!_audit) _audit = require('../AuditLogger');
    return _audit as AuditLoggerSurface;
}

// Lazy tuning — break config→Plugin→Event→… load-time cycle.
let _tuning: TuningConfig | undefined;
function tuning(): TuningConfig {
    if (!_tuning) _tuning = require('../../config').tuning;
    return _tuning as TuningConfig;
}

const logger = log4js.getLogger('rateLimit');

// Injectable clock. Production reads the real wall clock; tests freeze or step
// it so token-bucket refill math is deterministic regardless of CPU load.
let clockMs: () => number = Date.now;

interface Bucket {
    tokens: number;
    lastRefill: number;
}

class TokenBucketLimiter {
    private readonly buckets = new Map<string, Bucket>();

    constructor(
        private readonly capacity: number,
        private readonly refillPerSec: number
    ) {}

    consume(key: string): boolean {
        const now = clockMs();
        let bucket = this.buckets.get(key);
        if (!bucket) {
            bucket = {tokens: this.capacity, lastRefill: now};
            this.buckets.set(key, bucket);
        } else {
            this.refill(bucket, now);
        }
        if (bucket.tokens < 1) return false;
        bucket.tokens -= 1;
        return true;
    }

    /** Restore one token (cap at capacity). Used to undo a consume()
     *  when a multi-bucket gate later rejects. Refill first so a long
     *  gap between consume() and refund() doesn't under-credit. */
    refund(key: string): void {
        const bucket = this.buckets.get(key);
        if (!bucket) return;
        this.refill(bucket, clockMs());
        bucket.tokens = Math.min(this.capacity, bucket.tokens + 1);
    }

    sweep(): void {
        const now = clockMs();
        for (const [key, bucket] of this.buckets) {
            this.refill(bucket, now);
            if (bucket.tokens >= this.capacity) {
                this.buckets.delete(key);
            }
        }
    }

    private refill(bucket: Bucket, now: number): void {
        const elapsedSec = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(
            this.capacity,
            bucket.tokens + elapsedSec * this.refillPerSec
        );
        bucket.lastRefill = now;
    }
}

let general: TokenBucketLimiter | null = null;
let expensive: TokenBucketLimiter | null = null;
// Per-org overlay — caps fleet-wide damage from a single noisy tenant.
let orgGeneral: TokenBucketLimiter | null = null;
let orgExpensive: TokenBucketLimiter | null = null;
let expensiveMethods: ReadonlySet<string> | null = null;
// Method → pool registry populated by Component constructors when they see
// the @RateLimit decorator. Overrides the CSV when present.
const declaredPool = new Map<string, 'general' | 'expensive'>();

/** Called by Component#registerDecoratorMethods for each @RateLimit method. */
export function registerRateLimitPool(
    method: string,
    pool: 'general' | 'expensive'
): void {
    declaredPool.set(method.toLowerCase(), pool);
}
let sweepTimer: NodeJS.Timeout | null = null;

interface InitResult {
    general: TokenBucketLimiter;
    expensive: TokenBucketLimiter;
    orgGeneral: TokenBucketLimiter;
    orgExpensive: TokenBucketLimiter;
    expensiveMethods: ReadonlySet<string>;
}

function init(): InitResult {
    if (
        !general ||
        !expensive ||
        !orgGeneral ||
        !orgExpensive ||
        !expensiveMethods
    ) {
        const t = tuning().http;
        general = new TokenBucketLimiter(
            t.rateLimitGeneralRpm,
            t.rateLimitGeneralRpm / 60
        );
        expensive = new TokenBucketLimiter(
            t.rateLimitExpensiveRpm,
            t.rateLimitExpensiveRpm / 60
        );
        orgGeneral = new TokenBucketLimiter(
            t.rateLimitOrgGeneralRpm,
            t.rateLimitOrgGeneralRpm / 60
        );
        orgExpensive = new TokenBucketLimiter(
            t.rateLimitOrgExpensiveRpm,
            t.rateLimitOrgExpensiveRpm / 60
        );
        // Lowercase: dispatch is case-insensitive, so the CSV must match
        // a lowercased method name (else expensive methods fall to general).
        expensiveMethods = new Set(
            t.rateLimitExpensiveMethods.map((m) => m.toLowerCase())
        );
        ensureSweepTimer();
    }
    return {
        general,
        expensive,
        orgGeneral,
        orgExpensive,
        expensiveMethods
    };
}

function ensureSweepTimer(): void {
    if (sweepTimer) return;
    sweepTimer = setInterval(() => {
        general?.sweep();
        expensive?.sweep();
        orgGeneral?.sweep();
        orgExpensive?.sweep();
        for (const limiter of httpRouteBuckets.values()) {
            limiter.sweep();
        }
    }, 60_000);
    sweepTimer.unref();
}

// Org bucket first so a noisy tenant can't drain users' per-user
// allowance just to be rejected. User-bucket rejection refunds the org
// token to keep accounting clean. Anon → '<anon>' sentinel; missing
// orgId skips only the overlay.
// Memoizes method → lowercase. RPC volume is high; the toLowerCase
// allocation per call is wasted on the bounded set of registered methods.
const LOWER_METHOD_CACHE_MAX = 512;
const lowerMethodCache = new BoundedMap<string, string>({
    maxSize: LOWER_METHOD_CACHE_MAX
});

function lowerMethodKey(method: string): string {
    const cached = lowerMethodCache.get(method);
    if (cached !== undefined) return cached;
    const lower = method.toLowerCase();
    lowerMethodCache.set(method, lower);
    return lower;
}

export function enforceRateLimit(
    userId: string,
    method: string,
    organizationId?: string | null
): void {
    const limits = init();
    const userKey = userId || '<anon>';
    // Lower-case for both classification and bucket key, so case variation
    // can't split one method into separate buckets (multiplying the cap).
    const methodKey = lowerMethodKey(method);
    // @RateLimit declaration wins over the legacy CSV — registry is the SoT
    // once a method is decorated; CSV stays as the fallback for un-migrated
    // call sites.
    const declared = declaredPool.get(methodKey);
    const expensive = declared
        ? declared === 'expensive'
        : limits.expensiveMethods.has(methodKey);
    const userPool = expensive ? limits.expensive : limits.general;
    const orgPool = expensive ? limits.orgExpensive : limits.orgGeneral;
    const userBucketKey = `${userKey}:${methodKey}`;
    const orgBucketKey = organizationId
        ? `${organizationId}:${methodKey}`
        : null;

    if (orgBucketKey) {
        if (!orgPool.consume(orgBucketKey)) {
            logger.warn(
                'rate limit: org=%s method=%s (user=%s)',
                organizationId,
                method,
                userKey
            );
            void audit().logRateLimitExceeded({
                username: userKey,
                method,
                scope: 'organization',
                organizationId
            });
            throw RpcError.Domain('RateLimitExceeded', {
                details: {method, scope: 'organization'}
            });
        }
    }

    if (!userPool.consume(userBucketKey)) {
        // Refund the org-bucket token we just consumed so the noisy user
        // doesn't drain the whole tenant's allowance on the way out.
        if (orgBucketKey) orgPool.refund(orgBucketKey);
        logger.warn('rate limit: user=%s method=%s', userKey, method);
        void audit().logRateLimitExceeded({
            username: userKey,
            method,
            scope: 'user',
            organizationId
        });
        throw RpcError.Domain('RateLimitExceeded', {details: {method}});
    }
}

/** Shutdown — clear the sweep timer so the process can exit cleanly. */
export function stopRateLimitSweep(): void {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
}

/** Test helper — resets limiters, sweep timer, and the clock. */
export function __resetRateLimitForTests(): void {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
    general = null;
    expensive = null;
    orgGeneral = null;
    orgExpensive = null;
    expensiveMethods = null;
    httpRouteBuckets.clear();
    clockMs = Date.now;
}

/** Test helper — override the limiter clock; null restores the wall clock. */
export function __setRateLimitClockForTests(fn: (() => number) | null): void {
    clockMs = fn ?? Date.now;
}

// HTTP route rate limiter — per-(user or IP), per-named-bucket.

const httpRouteBuckets = new Map<string, TokenBucketLimiter>();

interface HttpRouteLimitOptions {
    /** Bucket pool id (usually route path). Shared when name matches. */
    name: string;
    /** Per-client tokens/min; 1 per request. */
    capacityPerMin: number;
}

function limiterFor(options: HttpRouteLimitOptions): TokenBucketLimiter {
    ensureSweepTimer();
    const existing = httpRouteBuckets.get(options.name);
    if (existing) return existing;
    const limiter = new TokenBucketLimiter(
        options.capacityPerMin,
        options.capacityPerMin / 60
    );
    httpRouteBuckets.set(options.name, limiter);
    return limiter;
}

// req.ip honors `trust proxy`, so a forged X-Forwarded-For can't spoof it.
function clientIp(req: Request): string | undefined {
    return req.ip || req.socket?.remoteAddress || undefined;
}

// Inlined, not imported from ../user, to keep this module's lazy-tuning contract.
const UNAUTHORIZED_USERNAME = '<UNAUTHORIZED>';

function clientKey(req: Request): string {
    const username = (req as any).user?.username;
    if (
        typeof username === 'string' &&
        username &&
        username !== UNAUTHORIZED_USERNAME
    ) {
        return `u:${username}`;
    }
    return `ip:${clientIp(req) ?? '<anon>'}`;
}

// Per-IP gate capping the pre-auth scoped-token DB round-trip.
const SCOPED_TOKEN_BUCKET = 'rpc-scoped-token';

function scopedTokenLimiter(): TokenBucketLimiter {
    return limiterFor({
        name: SCOPED_TOKEN_BUCKET,
        capacityPerMin: tuning().http.rateLimitScopedTokenPerMin
    });
}

export function tryScopedTokenAttempt(ip: string): boolean {
    if (scopedTokenLimiter().consume(`ip:${ip}`)) return true;
    logger.warn(
        'http rate limit: route=%s client=ip:%s',
        SCOPED_TOKEN_BUCKET,
        ip
    );
    void audit().logRateLimitExceeded({
        method: SCOPED_TOKEN_BUCKET,
        scope: 'http_route',
        ipAddress: ip
    });
    return false;
}

export function refundScopedTokenAttempt(ip: string): void {
    scopedTokenLimiter().refund(`ip:${ip}`);
}

/** Per-client HTTP route limiter middleware. 429 on exhaustion. */
export function httpRouteLimit(options: HttpRouteLimitOptions) {
    const limiter = limiterFor(options);
    return (req: Request, res: Response, next: NextFunction): void => {
        const key = clientKey(req);
        if (!limiter.consume(key)) {
            logger.warn(
                'http rate limit: route=%s client=%s',
                options.name,
                key
            );
            const ipAddress = clientIp(req);
            void audit().logRateLimitExceeded({
                username: (req as any).user?.username,
                method: options.name,
                scope: 'http_route',
                ipAddress,
                organizationId: (req as any).user?.organizationId
            });
            res.status(429).json({
                error: 'Too Many Requests',
                route: options.name
            });
            return;
        }
        next();
    };
}
