/**
 * Restore fm_permissions metadata from a JSON dump (Tier-3 rollback only).
 *
 * Use this when:
 *   1. Soak window has ended.
 *   2. fm_permissions metadata was deleted (cleanup-fm-permissions.ts --confirm ran).
 *   3. A serious bug in the new authz model is discovered.
 *   4. Rollback is the only viable option.
 *
 * Input: JSON dump from `audit-fm-permissions.ts --output=json` BEFORE cutover.
 * The dump has shape `{summary: {...}, users: [{userId, userName, permissionConfig, ...}]}`.
 *
 * This script is "break glass" — written and used once. Not maintained as a regular
 * tool. See docs/plans/2026-04-30-authz-rollback-runbook.md Tier 3.
 *
 * Usage:
 *   npx tsx backend/scripts/restore-fm-permissions.ts --input=snapshot.json --dry-run
 *   npx tsx backend/scripts/restore-fm-permissions.ts --input=snapshot.json --confirm
 */

import {readFileSync} from 'node:fs';

import {stableJson} from '../src/modules/authz/stableJson';
import {zitadelService} from '../src/modules/zitadel';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const inputFlag = args.find((a) => a.startsWith('--input='));
const INPUT_PATH = inputFlag?.split('=')[1];
interface RestoreResult {
    userId: string;
    userName: string;
    action: 'would-restore' | 'restored' | 'skipped' | 'error';
    error?: string;
}

interface DumpEntry {
    userId: string;
    userName: string;
    type: 'human' | 'machine';
    verdict: string;
    shapeSignature?: string;
    permissionConfig?: Record<string, unknown>;
    [k: string]: unknown;
}

interface Dump {
    summary: Record<string, unknown>;
    users: DumpEntry[];
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
    if (!INPUT_PATH) {
        console.error('ERROR: pass --input=<path-to-snapshot.json>');
        process.exit(2);
    }
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel not configured (.fleet-managerrc)');
        process.exit(2);
    }

    let dump: Dump;
    try {
        dump = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'));
    } catch (err) {
        console.error(`ERROR: cannot parse ${INPUT_PATH}: ${err}`);
        process.exit(2);
    }

    if (!Array.isArray(dump.users)) {
        console.error('ERROR: dump file missing "users" array');
        process.exit(2);
    }

    console.log(
        DRY_RUN
            ? `DRY-RUN: would restore ${dump.users.length} users from ${INPUT_PATH}`
            : `⚠ CONFIRM: restoring ${dump.users.length} users from ${INPUT_PATH}`
    );

    const results: RestoreResult[] = [];

    for (const entry of dump.users) {
        const result: RestoreResult = {
            userId: entry.userId,
            userName: entry.userName,
            action: 'skipped'
        };

        // Skip users that had no permissions originally.
        if (
            entry.verdict === 'no-permissions' ||
            entry.verdict === 'parse-error'
        ) {
            results.push(result);
            continue;
        }

        const config = entry.permissionConfig;
        if (!config || typeof config !== 'object') {
            result.action = 'error';
            result.error = 'missing permissionConfig in audit dump';
            results.push(result);
            continue;
        }

        try {
            if (DRY_RUN) {
                result.action = 'would-restore';
            } else {
                await zitadelService.setFmPermissions(entry.userId, config);
                const restored = await zitadelService.getFmPermissions(
                    entry.userId
                );
                if (stableJson(restored) !== stableJson(config)) {
                    throw new Error('metadata verification failed');
                }
                result.action = 'restored';
            }
        } catch (err) {
            result.action = 'error';
            result.error = err instanceof Error ? err.message : String(err);
        }
        results.push(result);
    }

    const summary = {
        total: results.length,
        wouldRestore: results.filter((r) => r.action === 'would-restore')
            .length,
        restored: results.filter((r) => r.action === 'restored').length,
        skipped: results.filter((r) => r.action === 'skipped').length,
        errors: results.filter((r) => r.action === 'error').length
    };

    console.log();
    console.log(`Total users:        ${summary.total}`);
    if (DRY_RUN) console.log(`Would restore:      ${summary.wouldRestore}`);
    else console.log(`Restored:           ${summary.restored}`);
    console.log(`Skipped (no perms): ${summary.skipped}`);
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
