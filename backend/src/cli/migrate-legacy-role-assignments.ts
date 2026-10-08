// Operational entrypoint: node dist/cli/migrate-legacy-role-assignments.js

import '../polyfills';
import 'dotenv/config';
import {configRc} from '../config';
import {
    initAuthzRuntime,
    invalidateAuthzTenant
} from '../modules/authz/runtime';
import * as store from '../modules/PostgresProvider';
import {
    type LegacyRoleMigrationDeps,
    type LegacyRoleMigrationReport,
    type LegacyRoleMigrationSubject,
    migrateLegacyRoleAssignments,
    type PlannedRoleAssignment
} from '../modules/user/legacyRoleAssignmentMigration';
import {zitadelService} from '../modules/zitadel';

const CREATED_BY = 'migrate-legacy-role-assignments';

export interface MigrationCliOptions {
    commit: boolean;
    output: 'text' | 'json';
    tenantIds?: string[];
}

export function parseMigrationCliArgs(
    argv: readonly string[]
): MigrationCliOptions {
    const tenantId = optionValue(argv, '--tenant-id=');
    return {
        commit: argv.includes('--commit'),
        output: optionValue(argv, '--output=') === 'json' ? 'json' : 'text',
        ...(tenantId ? {tenantIds: [tenantId]} : {})
    };
}

function optionValue(
    argv: readonly string[],
    prefix: string
): string | undefined {
    const arg = argv.find((candidate) => candidate.startsWith(prefix));
    return arg?.slice(prefix.length) || undefined;
}

export function migrationCliDeps(): LegacyRoleMigrationDeps {
    return {
        async listTenantIds() {
            const rows = await store.queryRows<{id: string}>(
                'SELECT id FROM organization.profile ORDER BY id'
            );
            return rows.map((row) => row.id);
        },

        async listSubjects(tenantId) {
            const [humans, machines] = await Promise.all([
                zitadelService.listUsers(tenantId),
                zitadelService.listMachineUsers(tenantId)
            ]);
            const subjects: LegacyRoleMigrationSubject[] = humans.map(
                (user) => ({
                    userId: user.userId,
                    userName: user.userName
                })
            );
            for (const machine of machines) {
                subjects.push({
                    userId: machine.userId,
                    userName: machine.userName ?? machine.name
                });
            }
            return subjects;
        },

        listRoleKeysByUser(tenantId, userIds) {
            return zitadelService.listProjectRoleKeysByUser(userIds, tenantId);
        },

        async listAssignedPersonaIdsByUser(tenantId, userIds) {
            // Expiry filter matches the resolver: a lapsed row grants nothing.
            const rows = await store.queryRows<{
                subject_id: string;
                persona_id: string;
            }>(
                `SELECT DISTINCT subject_id::text, persona_id::text
                   FROM organization.assignments
                  WHERE tenant_id = $1
                    AND subject_type = 'user'
                    AND subject_id = ANY($2::text[])
                    AND (expires_at IS NULL OR expires_at > now())`,
                [tenantId, userIds]
            );
            const byUser = new Map<string, string[]>();
            for (const row of rows) {
                const personaIds = byUser.get(row.subject_id) ?? [];
                personaIds.push(row.persona_id);
                byUser.set(row.subject_id, personaIds);
            }
            return byUser;
        },

        async listSystemPersonaIdsByKey() {
            const rows = await store.queryRows<{id: string; key: string}>(
                `SELECT id::text, key
                   FROM organization.personas
                  WHERE is_system_managed = true
                    AND tenant_id IS NULL`
            );
            return new Map(rows.map((row) => [row.key, row.id]));
        },

        async createAssignment(planned: PlannedRoleAssignment) {
            const rows = await store.queryRows<{id: string}>(
                `INSERT INTO organization.assignments
                     (tenant_id, subject_type, subject_id, persona_id, scope, created_by)
                 SELECT $1::varchar, 'user', $2::text, $3::uuid, '{"all": true}'::jsonb, $4::text
                 WHERE NOT EXISTS (
                     SELECT 1
                       FROM organization.assignments
                      WHERE tenant_id = $1::varchar
                        AND subject_type = 'user'
                        AND subject_id = $2::text
                        AND persona_id = $3::uuid
                        AND (expires_at IS NULL OR expires_at > now())
                 )
                 RETURNING id::text`,
                [
                    planned.tenantId,
                    planned.userId,
                    planned.personaId,
                    CREATED_BY
                ]
            );
            if (rows.length === 0) return false;
            await store.queryRows(
                `INSERT INTO organization.authz_audit
                     (tenant_id, actor_id, action, target_type, target_id, payload)
                 VALUES ($1::varchar, $2::text, 'migration.built_in_role_assigned', 'assignment', $3::text, $4::jsonb)`,
                [
                    planned.tenantId,
                    CREATED_BY,
                    rows[0].id,
                    JSON.stringify({
                        userId: planned.userId,
                        userName: planned.userName,
                        personaKey: planned.personaKey,
                        scope: {all: true}
                    })
                ]
            );
            return true;
        },

        async invalidateTenant(tenantId) {
            await invalidateAuthzTenant(tenantId);
        }
    };
}

export function formatMigrationReport(
    report: LegacyRoleMigrationReport
): string {
    const lines = [
        '='.repeat(60),
        'login roles -> FM assignments',
        '='.repeat(60),
        `Mode:              ${report.mode}`,
        `Tenants:           ${report.tenantIds.length}`,
        `Users scanned:     ${report.subjectsScanned}`,
        `Already assigned:  ${report.subjectsWithExistingAssignment}`,
        `No login role:     ${report.subjectsWithoutBuiltInRole}`,
        `Roles to write:    ${report.planned.length}`,
        `Sign-in viewers:   ${report.signInOnlyViewersDropped}`
    ];
    if (report.mode === 'apply') {
        lines.push(`Created:           ${report.created}`);
        lines.push(`Already present:   ${report.alreadyPresent}`);
    }
    for (const subject of report.subjects) {
        lines.push(
            `  ${subject.tenantId}  ${subject.userName} (${subject.userId})`
        );
        if (subject.materialize.length > 0) {
            lines.push(`      write: ${subject.materialize.join(', ')}`);
        }
        for (const key of subject.droppedSignInOnly) {
            lines.push(`      drop:  ${key} (sign-in role only)`);
        }
    }
    for (const key of report.unmatchedRoleKeys) {
        lines.push(`WARNING no system persona row for role "${key}"`);
    }
    return lines.join('\n');
}

export async function runMigrationCli(
    argv: readonly string[]
): Promise<number> {
    const options = parseMigrationCliArgs(argv);
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel not configured (.fleet-managerrc)');
        return 2;
    }
    if (!zitadelService.isManagementApiAvailable()) {
        console.error('ERROR: Zitadel Management API not available');
        return 2;
    }
    await store.initDatabase(configRc.internalStorage);
    // The runtime carries the Redis invalidation a write has to publish.
    if (options.commit) await initAuthzRuntime();

    const report = await migrateLegacyRoleAssignments(migrationCliDeps(), {
        mode: options.commit ? 'apply' : 'dry-run',
        ...(options.tenantIds ? {tenantIds: options.tenantIds} : {})
    });

    console.log(
        options.output === 'json'
            ? JSON.stringify(report, null, 2)
            : formatMigrationReport(report)
    );
    return 0;
}

if (typeof require !== 'undefined' && require.main === module) {
    runMigrationCli(process.argv.slice(2))
        .then((code) => process.exit(code))
        .catch((error) => {
            console.error('Fatal:', error);
            process.exit(2);
        });
}
