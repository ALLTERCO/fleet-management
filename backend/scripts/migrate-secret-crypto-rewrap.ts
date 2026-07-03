/**
 * Re-encrypts every row in notifications.integration_endpoint_secrets from
 * v1 (SHA-256) to v2 (scrypt). Idempotent — skips rows already at v2.
 *
 * Usage:
 *   FM_SECRET_KDF_SALT=... npx tsx scripts/migrate-secret-crypto-rewrap.ts --dry-run
 *   FM_SECRET_KDF_SALT=... npx tsx scripts/migrate-secret-crypto-rewrap.ts --confirm
 *
 * Refuses to run without an explicit flag.
 */

import {Client} from 'pg';
import {configRc} from '../src/config';
import {
    decryptJsonSecret,
    encryptJsonSecret
} from '../src/modules/secretCrypto';

interface Row {
    endpoint_id: number;
    encrypted_payload: string;
    updated_at: string;
}

async function main(): Promise<void> {
    const dryRun = process.argv.includes('--dry-run');
    if (!dryRun && !process.argv.includes('--confirm')) {
        throw new Error(
            'rewrap rewrites every endpoint secret — pass --dry-run to preview or --confirm to run'
        );
    }
    const conn = configRc.internalStorage?.connection;
    if (!conn) throw new Error('Postgres connection config missing');

    const client = new Client(conn);
    await client.connect();
    let rewrapped = 0;
    let skipped = 0;
    let failed = 0;
    try {
        const {rows} = await client.query<Row>(
            'SELECT endpoint_id, encrypted_payload, updated_at FROM notifications.integration_endpoint_secrets'
        );
        for (const row of rows) {
            if (row.encrypted_payload.startsWith('v2:')) {
                skipped++;
                continue;
            }
            try {
                const decoded = decryptJsonSecret(row.encrypted_payload);
                const reEncrypted = encryptJsonSecret(decoded);
                if (dryRun) {
                    console.log(
                        `[dry-run] would rewrap endpoint_id=${row.endpoint_id}`
                    );
                } else {
                    await client.query(
                        'SELECT notifications.fn_integration_endpoint_secret_set($1, $2, $3)',
                        [row.endpoint_id, reEncrypted, row.updated_at]
                    );
                    console.log(`rewrapped endpoint_id=${row.endpoint_id}`);
                }
                rewrapped++;
            } catch (err) {
                failed++;
                console.error(
                    `failed endpoint_id=${row.endpoint_id}:`,
                    err instanceof Error ? err.message : err
                );
            }
        }
    } finally {
        await client.end();
    }
    const tag = dryRun ? ' (dry-run)' : '';
    console.log(
        `done — rewrapped=${rewrapped} skipped=${skipped} failed=${failed}${tag}`
    );
    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error('fatal:', err);
    process.exit(2);
});
