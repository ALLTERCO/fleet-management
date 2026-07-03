// At-rest encryption key registry. Backed by FM_SECRET_ENCRYPTION_KEY (active)
// + optional FM_SECRET_ENCRYPTION_KEY_PREVIOUS (decryption-only, for rotation).
// Falls back to JWT_SECRET only for legacy decrypt/read helpers; non-dev boot
// validation requires a dedicated key.
//
// All reads go through envReader so future rotation tooling sees a single
// audit chokepoint (V-7).

import {envOptionalStr} from './envReader';
import {getJwtToken, PUBLIC_JWT_SECRET_FALLBACK} from './jwtSecret';

const KEY_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

// Entropy floor for an explicit at-rest encryption key (256-bit raw).
export const MIN_SECRET_KEY_LENGTH = 32;

function readKeyId(envVar: string, fallback: string): string {
    const raw = envOptionalStr(envVar);
    if (raw === undefined) return fallback;
    if (!KEY_ID_PATTERN.test(raw)) {
        throw new Error(
            `${envVar} must be alphanumeric / dash / dot / underscore`
        );
    }
    return raw;
}

// ANSWER: the active key material, in precedence order (override → dedicated
// → legacy JWT_SECRET). Throws when no source is configured — boot must fail
// loud rather than silently degrade to no encryption.
export function secretEncryptionKey(override?: string): string {
    const material =
        override?.trim() ||
        envOptionalStr('FM_SECRET_ENCRYPTION_KEY') ||
        envOptionalStr('JWT_SECRET') ||
        '';
    if (!material) {
        throw new Error(
            'Secret encryption key is not configured. Set FM_SECRET_ENCRYPTION_KEY or JWT_SECRET.'
        );
    }
    return material;
}

export function secretEncryptionKeyId(): string {
    return readKeyId('FM_SECRET_ENCRYPTION_KEY_ID', 'primary');
}

export interface PreviousKey {
    keyId: string;
    keyMaterial: string;
}

// Optional second key used only for decrypts during rotation overlap.
// Returns null when unset; once both halves are populated reads can fall
// through to the previous key on auth-tag mismatch.
export function secretEncryptionPreviousKey(): PreviousKey | null {
    const material = envOptionalStr('FM_SECRET_ENCRYPTION_KEY_PREVIOUS');
    if (!material) return null;
    const keyId = readKeyId('FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID', 'previous');
    return {keyId, keyMaterial: material};
}

// Single source for secret-configuration validation. Returns the list of
// fatal misconfigurations (empty when boot is safe). Used by
// warnIfInsecureProduction() in non-dev mode and by future ops tooling
// that needs the same checks without throwing.
export function describeSecretsMisconfiguration(
    jwtFromConfig?: string
): string[] {
    const jwtSecret = jwtFromConfig || getJwtToken();
    const fmSecret = envOptionalStr('FM_SECRET_ENCRYPTION_KEY') || '';
    const errors: string[] = [];
    if (!jwtSecret || jwtSecret === PUBLIC_JWT_SECRET_FALLBACK) {
        errors.push(
            'JWT_SECRET is missing or uses the default — all auth tokens are forgeable.'
        );
    }
    if (!fmSecret) {
        errors.push(
            'FM_SECRET_ENCRYPTION_KEY is missing — use a dedicated at-rest encryption key instead of sharing JWT_SECRET.'
        );
    }
    // A weak or shared key means one leak forges tokens AND decrypts every
    // credential, so an explicit key must be strong and distinct.
    if (fmSecret && fmSecret === jwtSecret) {
        errors.push(
            'FM_SECRET_ENCRYPTION_KEY must differ from JWT_SECRET — a shared key means one leak compromises both auth and at-rest encryption.'
        );
    }
    if (fmSecret && fmSecret.length < MIN_SECRET_KEY_LENGTH) {
        errors.push(
            `FM_SECRET_ENCRYPTION_KEY is too short — use at least ${MIN_SECRET_KEY_LENGTH} random characters (256-bit).`
        );
    }
    return errors;
}

// Non-fatal posture warnings surfaced at boot. Fatal rules live above.
export function describeSecretsWarnings(_jwtFromConfig?: string): string[] {
    return [];
}
