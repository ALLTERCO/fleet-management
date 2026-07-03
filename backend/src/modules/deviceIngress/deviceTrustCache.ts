import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import {deviceTrustCache, deviceTrustSignals} from '../redis/services';
import type {
    DeviceIngressLookupCredential,
    DeviceIngressTokenLookupCredential,
    findCertificateCredential,
    findTokenCredential
} from './deviceIngressRepository';

const logger = getLogger('device-trust-cache');

type TokenFinder = typeof findTokenCredential;
type CertificateFinder = typeof findCertificateCredential;
type AccessControlReader = (shellyID: string) => Promise<number>;

const TOKEN_PREFIX = 'tok:';
const CERT_PREFIX = 'cert:';
const ACCESS_PREFIX = 'ac:';

// Lets an id-keyed eviction reach the hash-keyed cache entries.
const lookupKeysByCredential = new Map<string, Set<string>>();
const lookupKeysByIdentity = new Map<string, Set<string>>();

function ttl(): number {
    return tuning.deviceIngress.trustCacheTtlSec;
}

function indexLookupKey(
    index: Map<string, Set<string>>,
    id: string,
    key: string
): void {
    const set = index.get(id) ?? new Set<string>();
    set.add(key);
    index.set(id, set);
}

function trackCredentialLookup(
    credential: DeviceIngressLookupCredential,
    key: string
): void {
    indexLookupKey(lookupKeysByCredential, credential.id, key);
    indexLookupKey(lookupKeysByIdentity, credential.identityId, key);
}

async function readCachedCredential<T>(key: string): Promise<T | null> {
    const cached = await deviceTrustCache.get(key);
    if (cached === null) return null;
    Observability.incrementCounter('device_trust_cache_hits_total');
    return JSON.parse(cached) as T;
}

async function writeCachedCredential(
    key: string,
    credential: DeviceIngressLookupCredential
): Promise<void> {
    trackCredentialLookup(credential, key);
    await deviceTrustCache.set(key, JSON.stringify(credential), ttl());
}

// Never cache a miss: a later mint must not stay masked.
export async function findTokenCredentialCached(
    input: {tokenHash: string},
    finder: TokenFinder
): Promise<DeviceIngressTokenLookupCredential | null> {
    const key = TOKEN_PREFIX + input.tokenHash;
    const cached =
        await readCachedCredential<DeviceIngressTokenLookupCredential>(key);
    if (cached) return cached;
    Observability.incrementCounter('device_trust_cache_misses_total');
    const credential = await finder(input);
    if (credential) await writeCachedCredential(key, credential);
    return credential;
}

export async function findCertificateCredentialCached(
    input: {fingerprint: string},
    finder: CertificateFinder
): Promise<DeviceIngressLookupCredential | null> {
    const key = CERT_PREFIX + input.fingerprint;
    const cached =
        await readCachedCredential<DeviceIngressLookupCredential>(key);
    if (cached) return cached;
    Observability.incrementCounter('device_trust_cache_misses_total');
    const credential = await finder(input);
    if (credential) await writeCachedCredential(key, credential);
    return credential;
}

export async function readAccessControlCached(
    shellyID: string,
    reader: AccessControlReader
): Promise<number> {
    const key = ACCESS_PREFIX + shellyID;
    const cached = await deviceTrustCache.get(key);
    if (cached !== null) {
        Observability.incrementCounter('device_trust_cache_hits_total');
        return Number(cached);
    }
    Observability.incrementCounter('device_trust_cache_misses_total');
    const value = await reader(shellyID);
    if (Number.isFinite(value)) {
        await deviceTrustCache.set(key, String(value), ttl());
    }
    return value;
}

async function evictLookupKeys(keys: Set<string> | undefined): Promise<void> {
    if (!keys) return;
    for (const key of keys) await deviceTrustCache.del(key);
}

function dropCredentialIndex(credentialId: string): Set<string> {
    const keys = lookupKeysByCredential.get(credentialId);
    lookupKeysByCredential.delete(credentialId);
    return keys ?? new Set<string>();
}

function dropIdentityIndex(identityId: string): Set<string> {
    const keys = lookupKeysByIdentity.get(identityId);
    lookupKeysByIdentity.delete(identityId);
    return keys ?? new Set<string>();
}

async function evictCredentialLocal(
    credentialId: string,
    identityId?: string
): Promise<void> {
    const keys = dropCredentialIndex(credentialId);
    if (identityId) {
        for (const key of dropIdentityIndex(identityId)) keys.add(key);
    }
    await evictLookupKeys(keys);
    Observability.incrementCounter('device_trust_cache_evictions_total');
}

async function evictIdentityLocal(identityId: string): Promise<void> {
    await evictLookupKeys(dropIdentityIndex(identityId));
    Observability.incrementCounter('device_trust_cache_evictions_total');
}

async function evictAccessControlLocal(externalId: string): Promise<void> {
    await deviceTrustCache.del(ACCESS_PREFIX + externalId);
    Observability.incrementCounter('device_trust_cache_evictions_total');
}

// Evict here and on peers — no instance may serve stale trust.
export async function invalidateCredential(input: {
    credentialId: string;
    identityId?: string;
}): Promise<void> {
    await evictCredentialLocal(input.credentialId, input.identityId);
    await deviceTrustSignals.publish({
        kind: 'credential-changed',
        credentialId: input.credentialId,
        identityId: input.identityId
    });
}

export async function invalidateIdentity(identityId: string): Promise<void> {
    await evictIdentityLocal(identityId);
    await deviceTrustSignals.publish({
        kind: 'credential-changed',
        identityId
    });
}

export async function invalidateAccessControl(
    externalId: string
): Promise<void> {
    await evictAccessControlLocal(externalId);
    await deviceTrustSignals.publish({
        kind: 'access-control-changed',
        externalId
    });
}

export async function subscribeDeviceTrustInvalidations(): Promise<void> {
    // Fired without await — log, don't let it escape.
    const logEvictError = (err: unknown): void =>
        logger.error('trust-cache evict failed: %s', err);
    await deviceTrustSignals.on((signal) => {
        if (signal.kind === 'access-control-changed' && signal.externalId) {
            void evictAccessControlLocal(signal.externalId).catch(
                logEvictError
            );
            return;
        }
        if (signal.credentialId) {
            void evictCredentialLocal(
                signal.credentialId,
                signal.identityId
            ).catch(logEvictError);
        } else if (signal.identityId) {
            void evictIdentityLocal(signal.identityId).catch(logEvictError);
        }
    });
}

export function clearDeviceTrustCacheIndexForTests(): void {
    lookupKeysByCredential.clear();
    lookupKeysByIdentity.clear();
}
