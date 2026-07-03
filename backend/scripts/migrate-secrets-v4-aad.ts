/**
 * Re-encrypts pre-v4 rows under v4 with AAD bound to (table, identity).
 * Idempotent — rows already at v4 are skipped. Runs against the same DB
 * the FM container uses; pulls connection from configRc.
 *
 * Tables + AAD shape:
 *   organization.certificates.private_key_encrypted
 *     → certificates:tenant:<tenant_id>:fp:<fingerprint_sha256>
 *   organization.device_credentials.password_encrypted
 *     → device_credentials:tenant:<tenant_id>:device:<device_id>
 *   organization.credential_pushes.password_encrypted
 *     → device_credentials:tenant:<tenant_id>:device:<device_id>   (same as above so the push
 *       worker can copy the blob into device_credentials without re-encrypting)
 *   notifications.integration_endpoint_secrets.encrypted_payload
 *     → integration_endpoint_secrets:endpoint:<endpoint_id>
 *
 * Usage:
 *   FM_SECRET_KDF_SALT=... FM_SECRET_ENCRYPTION_KEY=... \
 *     npx tsx scripts/migrate-secrets-v4-aad.ts [--dry-run]
 */

import {Client} from 'pg';
import {configRc} from '../src/config';
import {
    decryptJsonSecret,
    decryptStringSecret,
    encryptJsonSecret,
    encryptStringSecret
} from '../src/modules/secretCrypto';

interface Stats {
    rewrapped: number;
    skipped: number;
    failed: number;
}

const stats: Stats = {rewrapped: 0, skipped: 0, failed: 0};

const dryRun = process.argv.includes('--dry-run');

function isV4(payload: string | null | undefined): boolean {
    return typeof payload === 'string' && payload.startsWith('v4:');
}

async function rewrapStringColumn(
    client: Client,
    table: string,
    keyColumn: string,
    aadColumns: string[],
    pkColumn: string
): Promise<void> {
    const cols = [...new Set([pkColumn, keyColumn, ...aadColumns])].join(', ');
    const {rows} = await client.query<Record<string, string | null>>(
        `SELECT ${cols} FROM ${table} WHERE ${keyColumn} IS NOT NULL`
    );
    for (const row of rows) {
        const ct = row[keyColumn] as string | null;
        const pk = row[pkColumn];
        if (!ct || pk == null) continue;
        if (isV4(ct)) {
            stats.skipped++;
            continue;
        }
        // AAD inputs must all be non-null — otherwise the binding string is
        // ambiguous (e.g. 'tenant:null:device:null') and would round-trip
        // corruptly. Skip + report rather than silently mis-encrypt.
        const missing = aadColumns.filter((c) => row[c] == null);
        if (missing.length > 0) {
            stats.failed++;
            console.error(
                `skipped ${table} ${pkColumn}=${pk}: AAD column(s) null: ${missing.join(', ')}`
            );
            continue;
        }
        try {
            const aad = aadFor(table, row);
            const plaintext = decryptStringSecret(ct);
            const next = encryptStringSecret(plaintext, {additionalData: aad});
            if (dryRun) {
                console.log(
                    `[dry-run] would rewrap ${table} ${pkColumn}=${pk}`
                );
            } else {
                await client.query(
                    `UPDATE ${table} SET ${keyColumn} = $1 WHERE ${pkColumn} = $2`,
                    [next, pk]
                );
            }
            stats.rewrapped++;
        } catch (err) {
            stats.failed++;
            console.error(
                `failed ${table} ${pkColumn}=${pk}:`,
                err instanceof Error ? err.message : err
            );
        }
    }
}

async function rewrapIntegrationEndpointSecrets(client: Client): Promise<void> {
    const table = 'notifications.integration_endpoint_secrets';
    const {rows} = await client.query<{
        endpoint_id: number;
        encrypted_payload: string | null;
        updated_at: string;
    }>(
        `SELECT endpoint_id, encrypted_payload, updated_at FROM ${table} WHERE encrypted_payload IS NOT NULL`
    );
    for (const row of rows) {
        const ct = row.encrypted_payload;
        if (!ct) continue;
        if (isV4(ct)) {
            stats.skipped++;
            continue;
        }
        try {
            const aad = `integration_endpoint_secrets:endpoint:${row.endpoint_id}`;
            const decoded = decryptJsonSecret(ct);
            const next = encryptJsonSecret(decoded, {additionalData: aad});
            if (dryRun) {
                console.log(
                    `[dry-run] would rewrap ${table} endpoint_id=${row.endpoint_id}`
                );
            } else {
                await client.query(
                    'SELECT notifications.fn_integration_endpoint_secret_set($1, $2, $3)',
                    [row.endpoint_id, next, row.updated_at]
                );
            }
            stats.rewrapped++;
        } catch (err) {
            stats.failed++;
            console.error(
                `failed ${table} endpoint_id=${row.endpoint_id}:`,
                err instanceof Error ? err.message : err
            );
        }
    }
}

function aadFor(table: string, row: Record<string, string | null>): string {
    if (table === 'organization.certificates') {
        return `certificates:tenant:${row.tenant_id}:fp:${row.fingerprint_sha256}`;
    }
    if (
        table === 'organization.device_credentials' ||
        table === 'organization.credential_pushes'
    ) {
        return `device_credentials:tenant:${row.tenant_id}:device:${row.device_id}`;
    }
    throw new Error(`No AAD shape registered for table ${table}`);
}

async function main(): Promise<void> {
    const conn = configRc.internalStorage?.connection;
    if (!conn) throw new Error('Postgres connection config missing');
    const client = new Client(conn);
    await client.connect();
    try {
        await rewrapStringColumn(
            client,
            'organization.certificates',
            'private_key_encrypted',
            ['tenant_id', 'fingerprint_sha256'],
            'id'
        );
        await rewrapStringColumn(
            client,
            'organization.device_credentials',
            'password_encrypted',
            ['tenant_id', 'device_id'],
            'id'
        );
        await rewrapStringColumn(
            client,
            'organization.credential_pushes',
            'password_encrypted',
            ['tenant_id', 'device_id'],
            'id'
        );
        await rewrapIntegrationEndpointSecrets(client);
    } finally {
        await client.end();
    }
    console.log(
        `\nDone. rewrapped=${stats.rewrapped} skipped=${stats.skipped} failed=${stats.failed}${
            dryRun ? ' (dry-run)' : ''
        }`
    );
    if (stats.failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
