/**
 * Reconciler — detect drift between Zitadel identity state and FM authz state.
 *
 * Designed to run nightly (cron) post-cutover. Flags:
 *   - Zitadel users with no FM assignments AND no built-in Zitadel role grant
 *     (would be locked out).
 *   - FM assignments referencing user IDs that don't exist in Zitadel (orphans).
 *   - Service users missing the static `fleet-user` grant required post-migration.
 *
 * Read-only. Outputs JSON (or text). Does NOT mutate either side.
 *
 * Usage:
 *   npx tsx backend/scripts/reconcile-zitadel-fm.ts
 *   npx tsx backend/scripts/reconcile-zitadel-fm.ts --output=json > drift.json
 *
 * Requires Phase 2 schema (personas, assignments tables). Gracefully reports
 * "schema not yet present" if run pre-Phase-2.
 */

import {configRc} from '../src/config';
import * as store from '../src/modules/PostgresProvider';
import {zitadelService} from '../src/modules/zitadel';

const args = process.argv.slice(2);
const OUTPUT = (args.find((a) => a.startsWith('--output='))?.split('=')[1] ??
    'text') as 'text' | 'json';

const FLEET_USER_KEY = 'fleet-user';
const BUILT_IN_ROLE_KEYS = new Set([
    'admin',
    'installer',
    'viewer',
    'operator',
    FLEET_USER_KEY
]);

interface DriftReport {
    timestamp: string;
    schemaPresent: boolean;
    zitadelUsers: number;
    fmAssignments: number;
    issues: {
        wouldBeLockedOut: Array<{
            userId: string;
            userName: string;
            type: string;
        }>;
        orphanAssignments: Array<{assignmentId: string; subjectId: string}>;
        serviceUsersMissingFleetUser: Array<{userId: string; userName: string}>;
    };
}

async function checkFmSchema(): Promise<boolean> {
    try {
        await store.queryRows('SELECT 1 FROM organization.assignments LIMIT 1');
        return true;
    } catch {
        return false;
    }
}

async function main() {
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel not configured (.fleet-managerrc)');
        process.exit(2);
    }

    await store.initDatabase(configRc.internalStorage);

    const schemaPresent = await checkFmSchema();
    if (!schemaPresent) {
        const report: DriftReport = {
            timestamp: new Date().toISOString(),
            schemaPresent: false,
            zitadelUsers: 0,
            fmAssignments: 0,
            issues: {
                wouldBeLockedOut: [],
                orphanAssignments: [],
                serviceUsersMissingFleetUser: []
            }
        };
        if (OUTPUT === 'json') console.log(JSON.stringify(report, null, 2));
        else
            console.log(
                'Phase 2 schema not present. Reconciler will activate post-Phase-2.'
            );
        process.exit(0);
    }

    const [humans, machines] = await Promise.all([
        zitadelService.listUsers(),
        zitadelService.listMachineUsers()
    ]);

    const allUsers = [
        ...humans.map((u) => ({...u, type: 'human' as const})),
        ...machines.map((u) => ({
            userId: u.userId,
            userName: u.userName ?? u.name,
            type: 'machine' as const
        }))
    ];

    const assignmentsRaw = (await store.queryRows(
        `SELECT id::text, subject_type, subject_id::text
           FROM organization.assignments
          WHERE subject_type = 'user'`
    )) as unknown as Array<{
        id: string;
        subject_type: string;
        subject_id: string;
    }>;

    const userIdsWithFmAssignment = new Set<string>(
        assignmentsRaw.map((a) => a.subject_id)
    );
    const zitadelUserIds = new Set<string>(allUsers.map((u) => u.userId));

    const wouldBeLockedOut: DriftReport['issues']['wouldBeLockedOut'] = [];
    const serviceUsersMissingFleetUser: DriftReport['issues']['serviceUsersMissingFleetUser'] =
        [];

    for (const u of allUsers) {
        let roles: string[] = [];
        try {
            const r = await zitadelService.getUserRoles(u.userId);
            roles = (r?.roleKeys ?? r?.roles ?? []).map((x) =>
                String(x).toLowerCase()
            );
        } catch {
            // ignore — treat as no roles
        }
        const hasBuiltIn = roles.some((r) => BUILT_IN_ROLE_KEYS.has(r));
        const hasFleetUser = roles.includes(FLEET_USER_KEY);
        const hasFmAssignment = userIdsWithFmAssignment.has(u.userId);

        if (!hasBuiltIn && !hasFmAssignment) {
            wouldBeLockedOut.push({
                userId: u.userId,
                userName: u.userName,
                type: u.type
            });
        }

        if (u.type === 'machine' && !hasFleetUser) {
            serviceUsersMissingFleetUser.push({
                userId: u.userId,
                userName: u.userName
            });
        }
    }

    const orphanAssignments: DriftReport['issues']['orphanAssignments'] = [];
    for (const a of assignmentsRaw) {
        if (!zitadelUserIds.has(a.subject_id)) {
            orphanAssignments.push({
                assignmentId: a.id,
                subjectId: a.subject_id
            });
        }
    }

    const report: DriftReport = {
        timestamp: new Date().toISOString(),
        schemaPresent: true,
        zitadelUsers: allUsers.length,
        fmAssignments: assignmentsRaw.length,
        issues: {
            wouldBeLockedOut,
            orphanAssignments,
            serviceUsersMissingFleetUser
        }
    };

    if (OUTPUT === 'json') {
        console.log(JSON.stringify(report, null, 2));
        process.exit(report.issues.wouldBeLockedOut.length === 0 ? 0 : 1);
    }

    console.log('='.repeat(60));
    console.log('Reconciler Report');
    console.log('='.repeat(60));
    console.log(`Timestamp:                       ${report.timestamp}`);
    console.log(`Zitadel users:                   ${report.zitadelUsers}`);
    console.log(`FM user-assignments:             ${report.fmAssignments}`);
    console.log(`Would-be locked out:             ${wouldBeLockedOut.length}`);
    console.log(`Orphan FM assignments:           ${orphanAssignments.length}`);
    console.log(
        `SU missing fleet-user:           ${serviceUsersMissingFleetUser.length}`
    );

    if (wouldBeLockedOut.length > 0) {
        console.log();
        console.log('Would be locked out:');
        for (const r of wouldBeLockedOut)
            console.log(`  [${r.type}] ${r.userName} (${r.userId})`);
    }
    if (orphanAssignments.length > 0) {
        console.log();
        console.log('Orphan FM assignments:');
        for (const o of orphanAssignments)
            console.log(`  ${o.assignmentId} → user:${o.subjectId} (gone)`);
    }
    if (serviceUsersMissingFleetUser.length > 0) {
        console.log();
        console.log("Service users missing 'fleet-user' grant:");
        for (const su of serviceUsersMissingFleetUser)
            console.log(`  ${su.userName} (${su.userId})`);
    }

    const totalIssues =
        wouldBeLockedOut.length +
        orphanAssignments.length +
        serviceUsersMissingFleetUser.length;
    process.exit(totalIssues === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(2);
});
