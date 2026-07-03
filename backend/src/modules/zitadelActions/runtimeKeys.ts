// Runtime-mutable signing keys + SCIM toggle (runtime → env → empty).

import {createHash} from 'node:crypto';
import log4js from 'log4js';
import {envBool, envInt, envStr} from '../../config/envReader';
import {queryRows} from '../PostgresProvider';

const logger = log4js.getLogger('zitadel-actions');

interface RuntimeState {
    grantSigningKey?: string;
    grantSigningKeyPrevious?: string;
    gdprSigningKey?: string;
    gdprSigningKeyPrevious?: string;
    scimEnabled?: boolean;
    rotatedAt?: string;
    envHash?: string;
}

const ROW_KEY = 'zitadel-runtime';

function cacheTtlMs(): number {
    return envInt('FM_RUNTIME_KEYS_CACHE_TTL_MS', 30_000);
}

let cache: {state: RuntimeState; loadedAt: number} | null = null;

function envSigningHash(): string {
    const blob = `${envStr('FM_ZITADEL_GRANT_SIGNING_KEY', '')}|${envStr('FM_ZITADEL_GDPR_SIGNING_KEY', '')}`;
    return createHash('sha256').update(blob).digest('hex');
}

// Project to the current schema so renamed/removed fields (e.g. legacy
// actionSigningKey) don't survive round-trips through writeState's spread.
function pickKnown(value: unknown): RuntimeState {
    if (!value || typeof value !== 'object') return {};
    const v = value as Record<string, unknown>;
    const out: RuntimeState = {};
    if (typeof v.grantSigningKey === 'string')
        out.grantSigningKey = v.grantSigningKey;
    if (typeof v.grantSigningKeyPrevious === 'string')
        out.grantSigningKeyPrevious = v.grantSigningKeyPrevious;
    if (typeof v.gdprSigningKey === 'string')
        out.gdprSigningKey = v.gdprSigningKey;
    if (typeof v.gdprSigningKeyPrevious === 'string')
        out.gdprSigningKeyPrevious = v.gdprSigningKeyPrevious;
    if (typeof v.scimEnabled === 'boolean') out.scimEnabled = v.scimEnabled;
    if (typeof v.rotatedAt === 'string') out.rotatedAt = v.rotatedAt;
    if (typeof v.envHash === 'string') out.envHash = v.envHash;
    return out;
}

async function loadFromDb(): Promise<RuntimeState> {
    try {
        const rows = await queryRows<{value: unknown; env_hash: string}>(
            'SELECT value, env_hash FROM organization.system_runtime_config WHERE key = $1',
            [ROW_KEY]
        );
        const row = rows[0];
        if (!row) return {};
        // Env change ⇒ deploy reset; ignore stale runtime.
        if (row.env_hash !== envSigningHash()) {
            logger.warn(
                'runtime keystore env-hash mismatch — env changed since last UI rotation, ignoring runtime values'
            );
            return {};
        }
        return pickKnown(row.value);
    } catch (err) {
        logger.warn(
            'runtime keystore unreadable, falling back to env: %s',
            err
        );
        return {};
    }
}

async function getState(): Promise<RuntimeState> {
    if (cache && Date.now() - cache.loadedAt < cacheTtlMs()) {
        return cache.state;
    }
    const state = await loadFromDb();
    cache = {state, loadedAt: Date.now()};
    return state;
}

async function writeState(state: RuntimeState): Promise<void> {
    const envHash = envSigningHash();
    await queryRows(
        `INSERT INTO organization.system_runtime_config (key, value, env_hash, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             env_hash = EXCLUDED.env_hash,
             updated_at = NOW()`,
        [ROW_KEY, JSON.stringify(state), envHash]
    );
    cache = {state, loadedAt: Date.now()};
}

// ── Grant-removed Action V2 keys ──────────────────────────────────────────
export async function getGrantKeys(): Promise<{
    current: string;
    previous: string;
}> {
    const s = await getState();
    return {
        current:
            s.grantSigningKey ?? envStr('FM_ZITADEL_GRANT_SIGNING_KEY', ''),
        previous:
            s.grantSigningKeyPrevious ??
            envStr('FM_ZITADEL_GRANT_SIGNING_KEY_PREVIOUS', '')
    };
}

// ── GDPR keys ─────────────────────────────────────────────────────────────
export async function getGdprKeys(): Promise<{
    current: string;
    previous: string;
}> {
    const s = await getState();
    return {
        current: s.gdprSigningKey ?? envStr('FM_ZITADEL_GDPR_SIGNING_KEY', ''),
        previous:
            s.gdprSigningKeyPrevious ??
            envStr('FM_ZITADEL_GDPR_SIGNING_KEY_PREVIOUS', '')
    };
}

// ── SCIM toggle ──────────────────────────────────────────────────────────
export async function getScimEnabled(): Promise<boolean> {
    const s = await getState();
    if (typeof s.scimEnabled === 'boolean') return s.scimEnabled;
    return envBool('FM_ZITADEL_SCIM_ENABLED', false);
}

// Snapshots prior current → previous so dual-key verify spans the replay window.
// On first rotation after deploy the runtime state is empty (keys are
// env-backed); fall back to env so in-flight Zitadel deliveries signed with
// the env key still verify during the swap.
export async function rotateKeys(next: {
    grantSigningKey: string;
    gdprSigningKey: string;
    rotatedAt: string;
}): Promise<void> {
    const current = await getState();
    const priorGrant =
        current.grantSigningKey ?? envStr('FM_ZITADEL_GRANT_SIGNING_KEY', '');
    const priorGdpr =
        current.gdprSigningKey ?? envStr('FM_ZITADEL_GDPR_SIGNING_KEY', '');
    await writeState({
        ...current,
        grantSigningKey: next.grantSigningKey,
        grantSigningKeyPrevious: priorGrant,
        gdprSigningKey: next.gdprSigningKey,
        gdprSigningKeyPrevious: priorGdpr,
        rotatedAt: next.rotatedAt
    });
    logger.warn(
        'Zitadel signing keys rotated at %s — replay window keeps previous keys valid',
        next.rotatedAt
    );
}

// Optional cleanup after replay window expires.
export async function clearPreviousKeys(): Promise<void> {
    const current = await getState();
    await writeState({
        ...current,
        grantSigningKeyPrevious: '',
        gdprSigningKeyPrevious: ''
    });
}

export async function setScimEnabled(enabled: boolean): Promise<void> {
    const current = await getState();
    await writeState({...current, scimEnabled: enabled});
}

export async function getRotatedAt(): Promise<string | null> {
    return (await getState()).rotatedAt ?? null;
}

export function _testReset(): void {
    cache = null;
}
