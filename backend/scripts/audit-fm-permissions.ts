/**
 * Pre-flight audit: distribution of fm_permissions shapes across all users.
 *
 * Reports:
 *   - total users
 *   - users with no fm_permissions
 *   - users with invalid / unparseable shape
 *   - users with v1 (legacy) shape
 *   - users with v2 (role + overrides) shape
 *   - users with hybrid shape (built-in role + selectedComponents overrides)
 *   - histogram of unique shape signatures (after canonicalising)
 *   - duplicate-shape map for the migration's persona dedup
 *
 * Usage:
 *   npx tsx backend/scripts/audit-fm-permissions.ts
 *   npx tsx backend/scripts/audit-fm-permissions.ts --output json > audit.json
 *   npx tsx backend/scripts/audit-fm-permissions.ts --only-issues
 */

import {stableHash} from '../src/modules/authz/stableJson';
import {zitadelService} from '../src/modules/zitadel';

const args = process.argv.slice(2);
const OUTPUT = (args.find((a) => a.startsWith('--output='))?.split('=')[1] ??
    'text') as 'text' | 'json';
const ONLY_ISSUES = args.includes('--only-issues');

type Verdict =
    | 'no-permissions'
    | 'parse-error'
    | 'v1'
    | 'v2'
    | 'hybrid'
    | 'unknown-shape';

interface UserAudit {
    userId: string;
    userName: string;
    type: 'human' | 'machine';
    verdict: Verdict;
    error?: string;
    shapeSignature?: string;
    permissionConfig?: Record<string, unknown>;
    isBuiltInMatch?: boolean;
    builtInName?: string;
    overrideCount?: number;
}

const BUILTIN_SIGNATURES: Record<string, string> = {};

function shapeHash(shape: unknown): string {
    return stableHash(shape);
}

function detectVerdict(shape: any): {verdict: Verdict; overrideCount: number} {
    if (!shape) return {verdict: 'no-permissions', overrideCount: 0};
    if (typeof shape !== 'object')
        return {verdict: 'unknown-shape', overrideCount: 0};

    if ('version' in shape && Array.isArray(shape.permissions)) {
        return {verdict: 'v1', overrideCount: 0};
    }

    if ('role' in shape) {
        const overrides = shape.overrides ?? {};
        const overrideCount = Object.keys(overrides).length;
        if (overrideCount > 0) return {verdict: 'hybrid', overrideCount};
        return {verdict: 'v2', overrideCount: 0};
    }

    if ('components' in shape) {
        return {verdict: 'unknown-shape', overrideCount: 0};
    }

    return {verdict: 'unknown-shape', overrideCount: 0};
}

async function auditOne(
    user: {userId: string; userName: string},
    type: 'human' | 'machine'
): Promise<UserAudit> {
    const audit: UserAudit = {
        userId: user.userId,
        userName: user.userName,
        type,
        verdict: 'no-permissions'
    };

    try {
        const config = await zitadelService.getFmPermissions(user.userId);
        if (!config) return audit;

        const {verdict, overrideCount} = detectVerdict(config);
        audit.verdict = verdict;
        audit.overrideCount = overrideCount;
        audit.shapeSignature = shapeHash(config);
        audit.permissionConfig = config as Record<string, unknown>;

        if (BUILTIN_SIGNATURES[audit.shapeSignature]) {
            audit.isBuiltInMatch = true;
            audit.builtInName = BUILTIN_SIGNATURES[audit.shapeSignature];
        }
    } catch (err) {
        audit.verdict = 'parse-error';
        audit.error = err instanceof Error ? err.message : String(err);
    }

    return audit;
}

async function main() {
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel not configured (.fleet-managerrc)');
        process.exit(2);
    }

    const [humans, machines] = await Promise.all([
        zitadelService.listUsers(),
        zitadelService.listMachineUsers()
    ]);

    const results: UserAudit[] = [];
    for (const u of humans) results.push(await auditOne(u, 'human'));
    for (const u of machines)
        results.push(
            await auditOne(
                {userId: u.userId, userName: u.userName ?? u.name},
                'machine'
            )
        );

    const summary = {
        total: results.length,
        humans: humans.length,
        machines: machines.length,
        byVerdict: {} as Record<Verdict, number>,
        uniqueShapes: new Set<string>(),
        shapeFrequency: {} as Record<string, number>,
        duplicateShapes: 0,
        hybridCount: 0,
        averageOverrides: 0
    };

    for (const r of results) {
        summary.byVerdict[r.verdict] = (summary.byVerdict[r.verdict] ?? 0) + 1;
        if (r.shapeSignature) {
            summary.uniqueShapes.add(r.shapeSignature);
            summary.shapeFrequency[r.shapeSignature] =
                (summary.shapeFrequency[r.shapeSignature] ?? 0) + 1;
        }
        if (r.verdict === 'hybrid') {
            summary.hybridCount++;
            summary.averageOverrides += r.overrideCount ?? 0;
        }
    }
    if (summary.hybridCount > 0)
        summary.averageOverrides =
            summary.averageOverrides / summary.hybridCount;
    summary.duplicateShapes = Array.from(summary.uniqueShapes).filter(
        (s) => summary.shapeFrequency[s] > 1
    ).length;

    const filtered = ONLY_ISSUES
        ? results.filter(
              (r) =>
                  r.verdict === 'parse-error' ||
                  r.verdict === 'unknown-shape' ||
                  r.verdict === 'hybrid'
          )
        : results;

    if (OUTPUT === 'json') {
        console.log(
            JSON.stringify(
                {
                    summary: {
                        ...summary,
                        uniqueShapes: summary.uniqueShapes.size
                    },
                    users: filtered
                },
                null,
                2
            )
        );
        process.exit(0);
    }

    console.log('='.repeat(60));
    console.log('FM Permissions Audit — pre-migration distribution');
    console.log('='.repeat(60));
    console.log();
    console.log(`Total users:               ${summary.total}`);
    console.log(`  humans:                  ${summary.humans}`);
    console.log(`  service users:           ${summary.machines}`);
    console.log();
    console.log('By verdict:');
    for (const [k, v] of Object.entries(summary.byVerdict)) {
        console.log(`  ${k.padEnd(22)} ${v}`);
    }
    console.log();
    console.log(`Unique shape signatures:   ${summary.uniqueShapes.size}`);
    console.log(`Duplicate shapes (≥2):     ${summary.duplicateShapes}`);
    console.log(`Hybrid (built-in + ovr):   ${summary.hybridCount}`);
    if (summary.hybridCount > 0)
        console.log(
            `  average overrides/hybrid: ${summary.averageOverrides.toFixed(1)}`
        );
    console.log();

    if (ONLY_ISSUES) {
        console.log(`Issues (${filtered.length}):`);
        for (const r of filtered) {
            console.log(
                `  [${r.type}] ${r.userName} (${r.userId}) ${r.verdict}${r.error ? ` — ${r.error}` : ''}`
            );
        }
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
