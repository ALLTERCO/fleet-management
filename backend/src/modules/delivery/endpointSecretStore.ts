// Thin read/write over channel secrets for OAuth consent callbacks.

import {envInt} from '../../config/envReader';
import RpcError from '../../rpc/RpcError';
import {decryptJsonSecret, encryptJsonSecret} from '../secretCrypto';
import {createLazyPgCall} from './lazyPgCall';

type JsonRecord = Record<string, unknown>;

interface SecretConfigSnapshot {
    config: JsonRecord;
    // null => no row exists; passed back unchanged for CAS write.
    expectedUpdatedAt: string | null;
}

const {pgCall, setForTests} = createLazyPgCall();
export const __setCallMethodForTests = setForTests;

function casRetryLimit(): number {
    return envInt('FM_ENDPOINT_SECRET_CAS_RETRIES', 5);
}

// Legacy AAD string is stable so existing encrypted secrets still decrypt.
function endpointSecretAad(endpointId: number): string {
    return `integration_endpoint_secrets:endpoint:${endpointId}`;
}

function isRecord(v: unknown): v is JsonRecord {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

async function readSecretSnapshot(
    endpointId: number
): Promise<SecretConfigSnapshot> {
    const res = await pgCall('notifications.fn_channel_secret_get', {
        p_endpoint_id: endpointId
    });
    const row = res?.rows?.[0] as
        | {encrypted_payload?: string; updated_at?: string | Date | null}
        | undefined;
    if (!row) return {config: {}, expectedUpdatedAt: null};

    const ts = row.updated_at;
    const expectedUpdatedAt =
        ts == null ? null : ts instanceof Date ? ts.toISOString() : String(ts);
    if (!row.encrypted_payload) return {config: {}, expectedUpdatedAt};

    const decoded = decryptJsonSecret<JsonRecord>(row.encrypted_payload, {
        additionalData: endpointSecretAad(endpointId)
    });
    const config = isRecord(decoded) ? decoded : {};
    return {config, expectedUpdatedAt};
}

export async function readEndpointSecretConfig(
    endpointId: number
): Promise<JsonRecord> {
    return (await readSecretSnapshot(endpointId)).config;
}

// CAS write: returns true on success, false on optimistic-lock failure.
async function casWrite(
    endpointId: number,
    secretConfig: JsonRecord,
    expectedUpdatedAt: string | null
): Promise<boolean> {
    const hasSecrets = Object.keys(secretConfig).length > 0;
    const res = await pgCall('notifications.fn_channel_secret_set', {
        p_endpoint_id: endpointId,
        p_encrypted_payload: hasSecrets
            ? encryptJsonSecret(secretConfig, {
                  additionalData: endpointSecretAad(endpointId)
              })
            : null,
        p_expected_updated_at: expectedUpdatedAt
    });
    const row = res?.rows?.[0] as {fn_channel_secret_set?: boolean} | undefined;
    return row?.fn_channel_secret_set === true;
}

export async function readEndpointClientSecret(
    endpointId: number
): Promise<string | undefined> {
    const secrets = await readEndpointSecretConfig(endpointId);
    const auth = secrets.auth;
    if (!isRecord(auth)) return undefined;
    return typeof auth.clientSecret === 'string'
        ? auth.clientSecret
        : undefined;
}

// CAS read-modify-write; retries up to FM_ENDPOINT_SECRET_CAS_RETRIES.
export async function writeEndpointRefreshToken(
    endpointId: number,
    refreshToken: string
): Promise<void> {
    const maxAttempts = casRetryLimit();
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const snapshot = await readSecretSnapshot(endpointId);
        const auth = isRecord(snapshot.config.auth)
            ? {...snapshot.config.auth}
            : {};
        auth.refreshToken = refreshToken;
        const next = {...snapshot.config, auth};
        const ok = await casWrite(endpointId, next, snapshot.expectedUpdatedAt);
        if (ok) return;
    }
    throw RpcError.Unavailable(
        'endpoint-secret-store',
        `CAS retry budget exhausted after ${maxAttempts} attempts for endpoint ${endpointId}`
    );
}
