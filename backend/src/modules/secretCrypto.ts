// At-rest encryption. Payload format encodes both the key id used and whether
// AAD binding is in effect, so legacy (no-AAD) and bound rows coexist.
//
// Read-supported formats:
//   v4:keyId:aadFlag:iv:cipher:tag   (6 parts) aadFlag = 'a' (bound) | 'n' (none)
//   v3:keyId:iv:cipher:tag           (5 parts) legacy, no AAD slot
//   v2:iv:cipher:tag                 (4 parts) legacy, scrypt, default key
//   v1:iv:cipher:tag                 (4 parts) legacy, sha256-derived
//
// Writes always emit v4. AAD is bound when additionalData is supplied; the
// per-row flag tells decrypt whether to expect it. Strict callers can set
// requireBinding to refuse legacy (pre-v4) payloads.

import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    scryptSync
} from 'node:crypto';
import {
    type PreviousKey,
    secretEncryptionKey,
    secretEncryptionKeyId,
    secretEncryptionPreviousKey
} from '../config/secrets';
import {BoundedMap} from './boundedMap';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MIN_SALT_BYTES = 16;
const SCRYPT_COST = {N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
const WRITE_VERSION = 'v4';
const KEY_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const AAD_FLAG_BOUND = 'a';
const AAD_FLAG_NONE = 'n';

// Capped + TTL so per-tenant key rotations can't grow the cache forever.
const keyCache = new BoundedMap<string, Buffer>({
    maxSize: 1024,
    ttlMs: 3_600_000
});

function getSalt(override?: string): Buffer {
    const raw =
        override?.trim() || process.env.FM_SECRET_KDF_SALT?.trim() || '';
    if (raw.length < MIN_SALT_BYTES) {
        throw new Error(
            `FM_SECRET_KDF_SALT must be set (≥${MIN_SALT_BYTES} chars)`
        );
    }
    return Buffer.from(raw, 'utf8');
}

function deriveKey(
    version: string,
    keyMaterial: string,
    saltOverride?: string
): Buffer {
    // Trim before keying so " abc " and "abc" share one entry (getSalt trims).
    const cacheKey = `${version} ${keyMaterial} ${saltOverride?.trim() ?? ''}`;
    const cached = keyCache.get(cacheKey);
    if (cached) return cached;

    let key: Buffer;
    if (version === 'v1') {
        key = createHash('sha256').update(keyMaterial, 'utf8').digest();
    } else if (version === 'v2' || version === 'v3' || version === 'v4') {
        key = scryptSync(
            keyMaterial,
            getSalt(saltOverride),
            KEY_BYTES,
            SCRYPT_COST
        );
    } else {
        throw new Error(`Unknown encryption version: ${version}`);
    }
    keyCache.set(cacheKey, key);
    return key;
}

export interface CryptoOptions {
    keyMaterial?: string;
    kdfSalt?: string;
    /** Bind ciphertext to a context string (AES-GCM AAD). Required to decrypt v4 'a'-flag rows. */
    additionalData?: string;
    /** Refuse to decrypt pre-v4 payloads — guarantees AAD is in effect. */
    requireBinding?: boolean;
}

function encrypt(plaintext: Buffer, options?: CryptoOptions): string {
    const keyId = secretEncryptionKeyId();
    if (!KEY_ID_PATTERN.test(keyId)) {
        throw new Error(`Invalid keyId from secretEncryptionKeyId(): ${keyId}`);
    }
    const aadFlag = options?.additionalData ? AAD_FLAG_BOUND : AAD_FLAG_NONE;
    const iv = randomBytes(IV_BYTES);
    const key = deriveKey(
        WRITE_VERSION,
        secretEncryptionKey(options?.keyMaterial),
        options?.kdfSalt
    );
    const cipher = createCipheriv(ALGORITHM, key, iv);
    if (options?.additionalData) {
        cipher.setAAD(Buffer.from(options.additionalData, 'utf8'));
    }
    const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return [
        WRITE_VERSION,
        keyId,
        aadFlag,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        authTag.toString('base64url')
    ].join(':');
}

interface ParsedPayload {
    version: string;
    keyId: string | null;
    /** 'a' = bound, 'n' = none. null for pre-v4 payloads. */
    aadFlag: typeof AAD_FLAG_BOUND | typeof AAD_FLAG_NONE | null;
    iv: Buffer;
    ciphertext: Buffer;
    authTag: Buffer;
}

function parsePayload(payload: string): ParsedPayload {
    const parts = payload.split(':');
    if (parts.length === 6) {
        const [version, keyId, aadFlag, ivPart, ciphertextPart, authTagPart] =
            parts;
        if (
            version !== 'v4' ||
            !keyId ||
            !ivPart ||
            !ciphertextPart ||
            !authTagPart ||
            !KEY_ID_PATTERN.test(keyId) ||
            (aadFlag !== AAD_FLAG_BOUND && aadFlag !== AAD_FLAG_NONE)
        ) {
            throw new Error('Encrypted payload format is invalid');
        }
        return {
            version,
            keyId,
            aadFlag,
            iv: Buffer.from(ivPart, 'base64url'),
            ciphertext: Buffer.from(ciphertextPart, 'base64url'),
            authTag: Buffer.from(authTagPart, 'base64url')
        };
    }
    if (parts.length === 5) {
        const [version, keyId, ivPart, ciphertextPart, authTagPart] = parts;
        if (
            version !== 'v3' ||
            !keyId ||
            !ivPart ||
            !ciphertextPart ||
            !authTagPart ||
            !KEY_ID_PATTERN.test(keyId)
        ) {
            throw new Error('Encrypted payload format is invalid');
        }
        return {
            version,
            keyId,
            aadFlag: null,
            iv: Buffer.from(ivPart, 'base64url'),
            ciphertext: Buffer.from(ciphertextPart, 'base64url'),
            authTag: Buffer.from(authTagPart, 'base64url')
        };
    }
    if (parts.length === 4) {
        const [version, ivPart, ciphertextPart, authTagPart] = parts;
        if (
            (version !== 'v1' && version !== 'v2') ||
            !ivPart ||
            !ciphertextPart ||
            !authTagPart
        ) {
            throw new Error('Encrypted payload format is invalid');
        }
        return {
            version,
            keyId: null,
            aadFlag: null,
            iv: Buffer.from(ivPart, 'base64url'),
            ciphertext: Buffer.from(ciphertextPart, 'base64url'),
            authTag: Buffer.from(authTagPart, 'base64url')
        };
    }
    throw new Error('Encrypted payload format is invalid');
}

function tryDecrypt(
    parsed: ParsedPayload,
    keyMaterial: string,
    saltOverride: string | undefined,
    additionalData: string | undefined
): Buffer {
    const key = deriveKey(parsed.version, keyMaterial, saltOverride);
    const decipher = createDecipheriv(ALGORITHM, key, parsed.iv);
    // AAD is applied only when the payload says it was bound. Legacy (pre-v4)
    // payloads ignore caller-supplied AAD; strict callers can opt out via
    // requireBinding to refuse those rows.
    if (parsed.aadFlag === AAD_FLAG_BOUND && additionalData) {
        decipher.setAAD(Buffer.from(additionalData, 'utf8'));
    }
    // Reject a truncated GCM tag; a short tag weakens the integrity check.
    if (parsed.authTag.length !== TAG_BYTES) {
        throw new Error(
            `Invalid GCM auth tag length: ${parsed.authTag.length}`
        );
    }
    decipher.setAuthTag(parsed.authTag);
    return Buffer.concat([
        decipher.update(parsed.ciphertext),
        decipher.final()
    ]);
}

function pickCandidates(
    parsed: ParsedPayload,
    options?: CryptoOptions
): Array<{keyId: string; keyMaterial: string}> {
    if (options?.keyMaterial) {
        return [{keyId: 'override', keyMaterial: options.keyMaterial}];
    }
    const active = {
        keyId: secretEncryptionKeyId(),
        keyMaterial: secretEncryptionKey()
    };
    const previous: PreviousKey | null = secretEncryptionPreviousKey();
    if ((parsed.version === 'v3' || parsed.version === 'v4') && parsed.keyId) {
        if (parsed.keyId === active.keyId) return [active];
        if (previous && parsed.keyId === previous.keyId) return [previous];
        throw new Error(
            `Encrypted payload references unknown keyId '${parsed.keyId}' — set FM_SECRET_ENCRYPTION_KEY_PREVIOUS / _PREVIOUS_ID to the matching old key`
        );
    }
    return previous ? [active, previous] : [active];
}

function decrypt(payload: string, options?: CryptoOptions): Buffer {
    const parsed = parsePayload(payload);
    if (options?.requireBinding && parsed.aadFlag !== AAD_FLAG_BOUND) {
        throw new Error(
            "requireBinding=true rejected an unbound payload (pre-v4 or v4 'n')"
        );
    }
    if (parsed.aadFlag === AAD_FLAG_BOUND && !options?.additionalData) {
        throw new Error(
            'Payload was encrypted with AAD binding; decrypt requires matching additionalData'
        );
    }
    const candidates = pickCandidates(parsed, options);
    let lastError: Error | null = null;
    for (const candidate of candidates) {
        try {
            return tryDecrypt(
                parsed,
                candidate.keyMaterial,
                options?.kdfSalt,
                options?.additionalData
            );
        } catch (err) {
            lastError = err as Error;
        }
    }
    throw lastError ?? new Error('Decryption failed with no candidate keys');
}

export function encryptJsonSecret(
    value: unknown,
    options?: CryptoOptions
): string {
    return encrypt(Buffer.from(JSON.stringify(value), 'utf8'), options);
}

export function decryptJsonSecret<T = unknown>(
    payload: string,
    options?: CryptoOptions
): T {
    return JSON.parse(decrypt(payload, options).toString('utf8')) as T;
}

export function encryptStringSecret(
    plaintext: string,
    options?: CryptoOptions
): string {
    return encrypt(Buffer.from(plaintext, 'utf8'), options);
}

export function decryptStringSecret(
    payload: string,
    options?: CryptoOptions
): string {
    return decrypt(payload, options).toString('utf8');
}

export function __resetKeyCacheForTests(): void {
    keyCache.clear();
}
