/**
 * Pre-flight audit: every Zitadel service user, their grants, their fm_permissions.
 *
 * Reports per service user:
 *   - userId, userName, description
 *   - has 'fleet-user' grant?  (will be required post-migration)
 *   - has built-in role grant? (admin / installer / viewer / operator)
 *   - has fm_permissions metadata? (shape verdict)
 *   - integration hint (Node-RED / Alexa / mobile / unknown — best-effort by name)
 *
 * Usage:
 *   npx tsx backend/scripts/audit-service-users.ts
 *   npx tsx backend/scripts/audit-service-users.ts --output json > su-audit.json
 */

import {zitadelService} from '../src/modules/zitadel';

const args = process.argv.slice(2);
const OUTPUT = (args.find((a) => a.startsWith('--output='))?.split('=')[1] ??
    'text') as 'text' | 'json';

interface ServiceUserAudit {
    userId: string;
    userName: string;
    description?: string;
    hasFleetUserGrant: boolean;
    builtInRoles: string[];
    hasFmPermissions: boolean;
    fmPermissionsShape: 'none' | 'v1' | 'v2' | 'hybrid' | 'unknown' | 'error';
    integrationHint: 'mobile' | 'nodered' | 'alexa' | 'unknown';
    needsBackfill: boolean;
    backfillActions: string[];
}

const BUILT_IN_ROLE_KEYS = new Set([
    'admin',
    'installer',
    'viewer',
    'operator'
]);
const FLEET_USER_KEY = 'fleet-user';

function guessIntegration(
    name: string,
    description?: string
): ServiceUserAudit['integrationHint'] {
    const haystack = `${name} ${description ?? ''}`.toLowerCase();
    if (haystack.includes('alexa')) return 'alexa';
    if (haystack.includes('node-red') || haystack.includes('nodered'))
        return 'nodered';
    if (
        haystack.includes('mobile') ||
        haystack.includes('install') ||
        haystack.includes('provision')
    )
        return 'mobile';
    return 'unknown';
}

async function auditOne(machine: {
    userId: string;
    userName: string;
    name: string;
    description?: string;
}): Promise<ServiceUserAudit> {
    const audit: ServiceUserAudit = {
        userId: machine.userId,
        userName: machine.userName ?? machine.name,
        description: machine.description,
        hasFleetUserGrant: false,
        builtInRoles: [],
        hasFmPermissions: false,
        fmPermissionsShape: 'none',
        integrationHint: guessIntegration(
            machine.userName ?? machine.name,
            machine.description
        ),
        needsBackfill: false,
        backfillActions: []
    };

    try {
        const roles = await zitadelService.getUserRoles(machine.userId);
        const allRoles = roles?.roleKeys ?? roles?.roles ?? [];
        for (const role of allRoles) {
            const key = (role as unknown as string).toLowerCase();
            if (key === FLEET_USER_KEY) audit.hasFleetUserGrant = true;
            if (BUILT_IN_ROLE_KEYS.has(key)) audit.builtInRoles.push(key);
        }
    } catch (err) {
        audit.backfillActions.push(
            `getUserRoles failed: ${err instanceof Error ? err.message : err}`
        );
    }

    try {
        const config = await zitadelService.getFmPermissions(machine.userId);
        if (config) {
            audit.hasFmPermissions = true;
            if ('version' in (config as object))
                audit.fmPermissionsShape = 'v1';
            else if ('role' in (config as object)) {
                const overrides = (config as any).overrides ?? {};
                audit.fmPermissionsShape =
                    Object.keys(overrides).length > 0 ? 'hybrid' : 'v2';
            } else audit.fmPermissionsShape = 'unknown';
        }
    } catch (err) {
        audit.fmPermissionsShape = 'error';
        audit.backfillActions.push(
            `getFmPermissions failed: ${err instanceof Error ? err.message : err}`
        );
    }

    if (!audit.hasFleetUserGrant) {
        audit.needsBackfill = true;
        audit.backfillActions.push(`grant '${FLEET_USER_KEY}' role`);
    }
    if (audit.builtInRoles.length === 0 && !audit.hasFmPermissions) {
        audit.needsBackfill = true;
        audit.backfillActions.push(
            'no role + no fm_permissions: would be locked out post-migration'
        );
    }

    return audit;
}

async function main() {
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel not configured (.fleet-managerrc)');
        process.exit(2);
    }

    const machines = await zitadelService.listMachineUsers();
    const results: ServiceUserAudit[] = [];
    for (const m of machines) results.push(await auditOne(m));

    const summary = {
        total: results.length,
        missingFleetUserGrant: results.filter((r) => !r.hasFleetUserGrant)
            .length,
        needsBackfill: results.filter((r) => r.needsBackfill).length,
        byIntegration: {} as Record<string, number>,
        wouldBeLockedOut: results.filter(
            (r) => r.builtInRoles.length === 0 && !r.hasFmPermissions
        ).length
    };
    for (const r of results) {
        summary.byIntegration[r.integrationHint] =
            (summary.byIntegration[r.integrationHint] ?? 0) + 1;
    }

    if (OUTPUT === 'json') {
        console.log(JSON.stringify({summary, users: results}, null, 2));
        process.exit(0);
    }

    console.log('='.repeat(60));
    console.log('Service User Audit — pre-migration verification');
    console.log('='.repeat(60));
    console.log();
    console.log(`Total service users:        ${summary.total}`);
    console.log(`Missing fleet-user grant:   ${summary.missingFleetUserGrant}`);
    console.log(`Needs backfill (any):       ${summary.needsBackfill}`);
    console.log(`Would be locked out:        ${summary.wouldBeLockedOut}`);
    console.log();
    console.log('By integration:');
    for (const [k, v] of Object.entries(summary.byIntegration))
        console.log(`  ${k.padEnd(10)} ${v}`);
    console.log();

    for (const r of results) {
        const ok = !r.needsBackfill ? '✓' : '✗';
        console.log(`${ok} [${r.integrationHint}] ${r.userName} (${r.userId})`);
        console.log(
            `    fleet-user: ${r.hasFleetUserGrant ? 'yes' : 'NO'} | ` +
                `roles: [${r.builtInRoles.join(', ')}] | ` +
                `fm_permissions: ${r.fmPermissionsShape}`
        );
        if (r.backfillActions.length > 0) {
            for (const a of r.backfillActions) console.log(`      → ${a}`);
        }
    }

    if (summary.needsBackfill > 0) {
        console.log();
        console.log(
            `⚠ ${summary.needsBackfill} service user(s) need backfill before cutover.`
        );
        console.log(
            '   Recommended: re-run with --output json, write a backfill script' +
                ' that calls zitadelService.grantRolesToUser(userId, ["fleet-user"]).'
        );
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
