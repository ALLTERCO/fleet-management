// Bounded LRU + TTL cache for nodemailer transporters. Reusing a
// transporter across sends lets nodemailer cache its XOAUTH2 access
// token and avoids TCP/TLS churn. Bypassed when FM_SMTP_POOL_MAX=0.

import {envInt} from '../../config/envReader';
import {bestEffortSync} from '../util/fireAndForget';

const MAX_ENTRIES = envInt('FM_SMTP_POOL_MAX', 50, 0);
const TTL_MS = envInt('FM_SMTP_POOL_TTL_MS', 10 * 60_000, 1_000);

interface Closable {
    close(): void;
}

interface Entry<T extends Closable> {
    value: T;
    expiresAt: number;
}

const pool = new Map<string, Entry<Closable>>();

function now(): number {
    return Date.now();
}

function evictExpired(): void {
    const t = now();
    for (const [key, e] of pool) {
        if (e.expiresAt <= t) {
            bestEffortSync('smtp.transporter.close.evict-expired', () =>
                e.value.close()
            );
            pool.delete(key);
        }
    }
}

function evictOldestIfFull(): void {
    while (pool.size >= MAX_ENTRIES) {
        const oldestKey = pool.keys().next().value;
        if (oldestKey === undefined) return;
        const e = pool.get(oldestKey);
        if (e) {
            bestEffortSync('smtp.transporter.close.evict-oldest', () =>
                e.value.close()
            );
        }
        pool.delete(oldestKey);
    }
}

export function getOrCreateTransporter<T extends Closable>(
    key: string,
    factory: () => T
): T {
    if (MAX_ENTRIES === 0) return factory();
    evictExpired();
    const hit = pool.get(key);
    if (hit) {
        // Refresh LRU position + TTL on use.
        pool.delete(key);
        hit.expiresAt = now() + TTL_MS;
        pool.set(key, hit);
        return hit.value as T;
    }
    evictOldestIfFull();
    const value = factory();
    pool.set(key, {value, expiresAt: now() + TTL_MS});
    return value;
}

/** Drop an entry and close it. Call after an auth/connection error
 *  so the next send builds a fresh transporter. */
export function invalidateTransporter(key: string): void {
    const e = pool.get(key);
    if (!e) return;
    pool.delete(key);
    bestEffortSync('smtp.transporter.close.invalidate', () => e.value.close());
}

/** Close + drop everything. Used by tests and shutdown. */
export function drainTransporterPool(): void {
    for (const [, e] of pool) {
        bestEffortSync('smtp.transporter.close.drain', () => e.value.close());
    }
    pool.clear();
}

export function __poolSizeForTests(): number {
    return pool.size;
}
