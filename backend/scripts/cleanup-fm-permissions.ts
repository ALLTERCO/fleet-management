/**
 * Cleanup: delete fm_permissions metadata from every Zitadel user.
 *
 * Run AFTER 14-day soak (per docs/blitz/phases/phase-11-cleanup.md, sub-phase 11.1).
 * The metadata is the Tier-3 rollback insurance — do NOT run this until soak is
 * confirmed clean and a separate JSON dump (audit-fm-permissions.ts --output=json)
 * has been archived per docs/plans/2026-04-30-authz-rollback-runbook.md.
 *
 * Usage:
 *   npx tsx backend/scripts/cleanup-fm-permissions.ts --dry-run
 *   npx tsx backend/scripts/cleanup-fm-permissions.ts --confirm
 *
 * Refuses to run without an explicit flag.
 */

import {configRc} from '../src/config';
import {fmClientOrgId} from '../src/config/zitadel';
import * as store from '../src/modules/PostgresProvider';
import {zitadelService} from '../src/modules/zitadel';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const FM_PERMISSIONS_KEY = 'fm_permissions';
const TENANT_ID =
    args.find((a) => a.startsWith('--tenant-id='))?.split('=')[1] ??
    fmClientOrgId();
const ACTOR_ID =
    args.find((a) => a.startsWith('--actor-id='))?.split('=')[1] ??
    'cleanup-fm-permissions';

interface CleanupResult {
    userId: string;
    userName: string;
    type: 'human' | 'machine';
    hadMetadata: boolean;
    action: 'would-delete' | 'deleted' | 'not-found' | 'error';
    error?: string;
}

async function processUser(
    user: {userId: string; userName: string},
    type: 'human' | 'machine',
    tenantId: string
): Promise<CleanupResult> {
    const result: CleanupResult = {
        userId: user.userId,
        userName: user.userName,
        type,
        hadMetadata: false,
        action: 'not-found'
    };

    try {
        const config = await zitadelService.getFmPermissions(user.userId);
        result.hadMetadata = config !== null;
        if (!result.hadMetadata) return result;

        if (DRY_RUN) {
            result.action = 'would-delete';
            return result;
        }

        await zitadelService.removeUserMetadata(
            user.userId,
            FM_PERMISSIONS_KEY
        );
        await store.queryRows(
            `INSERT INTO organization.authz_audit
                 (tenant_id, actor_id, action, target_type, target_id, payload)
             VALUES ($1, $2, 'cleanup.metadata_removed', 'assignment', $3, $4::jsonb)`,
            [
                tenantId,
                ACTOR_ID,
                user.userId,
                JSON.stringify({metadataKey: FM_PERMISSIONS_KEY})
            ]
        );
        result.action = 'deleted';
    } catch (err) {
        result.action = 'error';
        result.error = err instanceof Error ? err.message : String(err);
    }
    return result;
}

async function resolveTenantId(): Promise<string> {
    if (TENANT_ID) return TENANT_ID;
    const rows = await store.queryRows<{id: string}>(
        'SELECT id FROM organization.profile ORDER BY id LIMIT 2'
    );
    if (rows.length === 1) return rows[0].id;
    throw new Error(
        'tenant is ambiguous; set FM_CLIENT_ORG_ID or pass --tenant-id=<id>'
    );
}

async function main() {
    if (!DRY_RUN && !CONFIRM) {
        console.error('ERROR: pass --dry-run or --confirm');
        process.exit(2);
    }
    if (DRY_RUN && CONFIRM) {
        console.error('ERROR: --dry-run and --confirm are mutually exclusive');
        process.exit(2);
    }
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel not configured (.fleet-managerrc)');
        process.exit(2);
    }
    let tenantId = '';
    if (CONFIRM) {
        await store.initDatabase(configRc.internalStorage);
        tenantId = await resolveTenantId();
    }

    console.log(
        DRY_RUN
            ? 'DRY-RUN: no metadata will be deleted'
            : '⚠ CONFIRM: deleting fm_permissions metadata'
    );

    const [humans, machines] = await Promise.all([
        zitadelService.listUsers(),
        zitadelService.listMachineUsers()
    ]);

    const results: CleanupResult[] = [];
    for (const u of humans)
        results.push(await processUser(u, 'human', tenantId));
    for (const u of machines)
        results.push(
            await processUser(
                {userId: u.userId, userName: u.userName ?? u.name},
                'machine',
                tenantId
            )
        );

    const summary = {
        total: results.length,
        hadMetadata: results.filter((r) => r.hadMetadata).length,
        deleted: results.filter((r) => r.action === 'deleted').length,
        wouldDelete: results.filter((r) => r.action === 'would-delete').length,
        errors: results.filter((r) => r.action === 'error').length
    };

    console.log();
    console.log(`Total users:        ${summary.total}`);
    console.log(`Had fm_permissions: ${summary.hadMetadata}`);
    if (DRY_RUN) console.log(`Would delete:       ${summary.wouldDelete}`);
    else console.log(`Deleted:            ${summary.deleted}`);
    console.log(`Errors:             ${summary.errors}`);

    if (summary.errors > 0) {
        console.log();
        console.log('Errors:');
        for (const r of results.filter((r) => r.action === 'error'))
            console.log(`  ${r.userName} (${r.userId}): ${r.error}`);
        process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
