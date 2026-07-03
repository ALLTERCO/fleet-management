/**
 * Migrate Zitadel fm_permissions metadata into FM personas + assignments.
 *
 * Dry-run by default. Use --commit to write. Built-in matches stay in Zitadel
 * grants; custom/scoped shapes become tenant personas and direct assignments.
 */

import {configRc} from '../src/config';
import {fmClientOrgId} from '../src/config/zitadel';
import type {
    ComponentName,
    CrudOperation,
    FleetPermissionConfig,
    ScopedExecutablePermission,
    ScopedPermission
} from '../src/model/permissions';
import {COMPONENT_ORDER} from '../src/model/permissions';
import {
    extractSelectedIds,
    isResourceAssignmentArray,
    RESOURCE_ROLES,
    type ResourceAssignment,
    type ResourceRole,
    roleAllowsOp
} from '../src/model/resourceRoles';
import {
    type FleetRoleSlug,
    parsePermissionConfig,
    ROLE_TEMPLATES
} from '../src/model/roleTemplates';
import {authzAction, authzResourceType} from '../src/modules/authz/actionMap';
import {stableHash, stableJson} from '../src/modules/authz/stableJson';
import type {Scope} from '../src/modules/authz/types';
import * as store from '../src/modules/PostgresProvider';
import {zitadelService} from '../src/modules/zitadel';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const OUTPUT = (args.find((a) => a.startsWith('--output='))?.split('=')[1] ??
    'text') as 'text' | 'json';
const TENANT_ID =
    args.find((a) => a.startsWith('--tenant-id='))?.split('=')[1] ??
    fmClientOrgId();
const CREATED_BY =
    args.find((a) => a.startsWith('--created-by='))?.split('=')[1] ??
    'migrate-fm-permissions-to-personas';

type BuiltInRole = Extract<
    FleetRoleSlug,
    'Admin' | 'Installer' | 'Viewer' | 'Operator'
>;

interface ListedUser {
    userId: string;
    userName: string;
    type: 'human' | 'machine';
}

interface Statement {
    actions: string[];
    resource_types: string[];
}

interface ScopedStatementGroup {
    scope: Scope;
    statements: Statement[];
}

interface LegacyPermissionConfig {
    version: number;
    permissions: string[];
    groups: number[];
    devices: string[];
}

interface UserResult {
    userId: string;
    userName: string;
    type: 'human' | 'machine';
    action:
        | 'skipped'
        | 'would-grant-built-in'
        | 'granted-built-in'
        | 'would-migrate-custom'
        | 'migrated-custom'
        | 'error';
    role?: string;
    personaCount?: number;
    assignmentCount?: number;
    error?: string;
}

const BUILT_IN_ROLE_KEYS: Record<BuiltInRole, string> = {
    Admin: 'admin',
    Installer: 'installer',
    Viewer: 'viewer',
    Operator: 'operator'
};

const BUILT_IN_SIGNATURES = Object.fromEntries(
    (Object.keys(BUILT_IN_ROLE_KEYS) as BuiltInRole[]).map((role) => [
        stableJson(ROLE_TEMPLATES[role]),
        role
    ])
) as Record<string, BuiltInRole>;

const CRUD_OPS: CrudOperation[] = [
    'create',
    'read',
    'update',
    'delete',
    'execute'
];

async function listAllUsers(): Promise<ListedUser[]> {
    const [humans, machines] = await Promise.all([
        zitadelService.listUsers(),
        zitadelService.listMachineUsers()
    ]);
    return [
        ...humans.map((u) => ({
            userId: u.userId,
            userName: u.userName,
            type: 'human' as const
        })),
        ...machines.map((u) => ({
            userId: u.userId,
            userName: u.userName ?? u.name,
            type: 'machine' as const
        }))
    ];
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

async function tagKeyMap(
    tenantId: string,
    tagIds: number[]
): Promise<Map<number, string>> {
    if (tagIds.length === 0) return new Map();
    const rows = await store.queryRows<{id: number; key: string}>(
        `SELECT id, key
           FROM organization.tags
          WHERE organization_id = $1
            AND id = ANY($2::int[])`,
        [tenantId, tagIds]
    );
    return new Map(rows.map((r) => [r.id, r.key]));
}

function builtInMatch(config: FleetPermissionConfig): BuiltInRole | undefined {
    return BUILT_IN_SIGNATURES[stableJson(config)];
}

function isLegacyPermissionConfig(raw: unknown): raw is LegacyPermissionConfig {
    if (!raw || typeof raw !== 'object') return false;
    const obj = raw as Record<string, unknown>;
    return (
        typeof obj.version === 'number' &&
        Array.isArray(obj.permissions) &&
        Array.isArray(obj.groups) &&
        Array.isArray(obj.devices)
    );
}

function legacyBuiltInMatch(
    config: LegacyPermissionConfig
): BuiltInRole | undefined {
    const permissions = config.permissions.map((p) => p.toLowerCase());
    if (permissions.includes('*')) return 'Admin';
    const hasReadAll = permissions.includes('read:*');
    const hasWaitingRoom = permissions.some(
        (p) => p === 'waitingroom:*' || p === 'waiting_room:*'
    );
    if (hasReadAll && hasWaitingRoom) return 'Installer';
    if (hasReadAll) return 'Viewer';
    return undefined;
}

function enabledOps(
    component: ComponentName,
    perms: Record<string, unknown>
): CrudOperation[] {
    return CRUD_OPS.filter((op) => {
        if (op === 'execute' && !('execute' in perms)) return false;
        return perms[op] === true && authzAction(component, op).length > 0;
    });
}

function scopeForIds(
    component: ComponentName,
    ids: Array<string | number>,
    tagsById: Map<number, string>
): Scope | null {
    if (ids.length === 0) return null;
    if (component === 'devices') return {device_ids: ids.map(String)};
    if (component === 'locations') return {location_ids: ids.map(Number)};
    if (component === 'groups') return {device_group_ids: ids.map(Number)};
    if (component === 'dashboards') return {dashboard_ids: ids.map(Number)};
    if (component === 'plugins') return {plugin_keys: ids.map(String)};
    if (component === 'tags') {
        const keys = ids.map((id) => tagsById.get(Number(id))).filter(Boolean);
        return keys.length > 0 ? {device_tags: keys as string[]} : null;
    }
    return {all: true};
}

function addScopedStatement(
    groups: Map<string, ScopedStatementGroup>,
    scope: Scope,
    statement: Statement
) {
    const key = stableJson(scope);
    const group = groups.get(key);
    if (group) {
        group.statements.push(statement);
        return;
    }
    groups.set(key, {scope, statements: [statement]});
}

function actionsForRole(
    component: ComponentName,
    role: ResourceRole
): string[] {
    return CRUD_OPS.filter((op) => roleAllowsOp(component, role, op)).map(
        (op) => authzAction(component, op)
    );
}

function addPerItemRoleStatements(
    component: ComponentName,
    selected: ResourceAssignment[],
    tagsById: Map<number, string>,
    groups: Map<string, ScopedStatementGroup>
) {
    for (const role of RESOURCE_ROLES) {
        const ids = selected
            .filter((item) => item.role === role)
            .map((item) => item.id);
        const scope = scopeForIds(component, ids, tagsById);
        if (!scope) continue;
        const actions = Array.from(new Set(actionsForRole(component, role)));
        if (actions.length === 0) continue;
        addScopedStatement(groups, scope, {
            actions,
            resource_types: [authzResourceType(component)]
        });
    }
}

async function buildScopedStatementGroups(
    tenantId: string,
    config: FleetPermissionConfig
): Promise<ScopedStatementGroup[]> {
    const tagIds = extractSelectedIds<number>(
        config.components.tags?.selected as any
    ).map(Number);
    const tagsById = await tagKeyMap(tenantId, tagIds);
    const groups = new Map<string, ScopedStatementGroup>();

    for (const component of COMPONENT_ORDER) {
        const perms = config.components[component];
        if (!perms) continue;

        if ('scope' in perms && perms.scope === 'SELECTED') {
            const selected = (perms as ScopedPermission<string | number>)
                .selected;
            if (!selected || selected.length === 0) continue;
            if (isResourceAssignmentArray(selected)) {
                addPerItemRoleStatements(component, selected, tagsById, groups);
                continue;
            }
            const ids = extractSelectedIds<string | number>(selected);
            const scope = scopeForIds(component, ids, tagsById);
            if (!scope) continue;
            const actions = enabledOps(component, perms as any).map((op) =>
                authzAction(component, op)
            );
            if (actions.length === 0) continue;
            addScopedStatement(groups, scope, {
                actions: Array.from(new Set(actions)),
                resource_types: [authzResourceType(component)]
            });
            continue;
        }

        const actions = enabledOps(
            component,
            perms as ScopedExecutablePermission<string>
        ).map((op) => authzAction(component, op));
        if (actions.length === 0) continue;
        addScopedStatement(
            groups,
            {all: true},
            {
                actions: Array.from(new Set(actions)),
                resource_types: [authzResourceType(component)]
            }
        );
    }

    return Array.from(groups.values());
}

function buildLegacyScopedStatementGroups(
    config: LegacyPermissionConfig
): ScopedStatementGroup[] {
    const groups = new Map<string, ScopedStatementGroup>();
    const permissions = config.permissions.map((p) => p.toLowerCase());

    if (permissions.includes('*')) {
        addScopedStatement(
            groups,
            {all: true},
            {
                actions: ['*'],
                resource_types: ['*']
            }
        );
    }

    if (permissions.includes('read:*')) {
        for (const component of COMPONENT_ORDER) {
            addScopedStatement(
                groups,
                {all: true},
                {
                    actions: [authzAction(component, 'read')],
                    resource_types: [authzResourceType(component)]
                }
            );
        }
    }

    if (
        permissions.some((p) => p === 'waitingroom:*' || p === 'waiting_room:*')
    ) {
        addScopedStatement(
            groups,
            {all: true},
            {
                actions: [
                    authzAction('waiting_room', 'read'),
                    authzAction('waiting_room', 'create'),
                    authzAction('waiting_room', 'delete')
                ],
                resource_types: [authzResourceType('waiting_room')]
            }
        );
    }

    if (config.devices.length > 0) {
        addScopedStatement(
            groups,
            {device_ids: config.devices.map(String)},
            {
                actions: [authzAction('devices', 'read')],
                resource_types: [authzResourceType('devices')]
            }
        );
    }

    if (config.groups.length > 0) {
        addScopedStatement(
            groups,
            {device_group_ids: config.groups.map(Number)},
            {
                actions: [authzAction('devices', 'read')],
                resource_types: [authzResourceType('devices')]
            }
        );
    }

    return Array.from(groups.values());
}

async function upsertPersonaAndAssignment(
    tenantId: string,
    user: ListedUser,
    sourceHash: string,
    index: number,
    group: ScopedStatementGroup
): Promise<{personaId: string; insertedAssignment: boolean}> {
    const key = `migrated_${stableHash(user.userId, 10)}_${sourceHash}_${index}`;
    const name = `Migrated ${user.userName} ${index + 1}`;
    const rows = await store.queryRows<{id: string}>(
        `INSERT INTO organization.personas
             (tenant_id, key, name, description, is_system_managed, statements)
         VALUES ($1, $2, $3, $4, false, $5::jsonb)
         ON CONFLICT (tenant_id, key) WHERE tenant_id IS NOT NULL
         DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             statements = EXCLUDED.statements,
             updated_at = now()
         RETURNING id::text`,
        [
            tenantId,
            key,
            name,
            'Migrated from Zitadel fm_permissions metadata',
            JSON.stringify(group.statements)
        ]
    );
    const personaId = rows[0].id;
    const assignmentRows = await store.queryRows<{id: string}>(
        `INSERT INTO organization.assignments
             (tenant_id, subject_type, subject_id, persona_id, scope, created_by)
         SELECT $1, 'user', $2, $3::uuid, $4::jsonb, $5
         WHERE NOT EXISTS (
             SELECT 1
               FROM organization.assignments
              WHERE tenant_id = $1
                AND subject_type = 'user'
                AND subject_id = $2
                AND persona_id = $3::uuid
         )
         RETURNING id::text`,
        [
            tenantId,
            user.userId,
            personaId,
            JSON.stringify(group.scope),
            CREATED_BY
        ]
    );
    return {personaId, insertedAssignment: assignmentRows.length > 0};
}

async function writeMigrationAudit(
    tenantId: string,
    user: ListedUser,
    action: string,
    payload: Record<string, unknown>
) {
    await store.queryRows(
        `INSERT INTO organization.authz_audit
             (tenant_id, actor_id, action, target_type, target_id, payload)
         VALUES ($1, $2, $3, 'assignment', $4, $5::jsonb)`,
        [tenantId, CREATED_BY, action, user.userId, JSON.stringify(payload)]
    );
}

async function migrateUser(
    tenantId: string,
    user: ListedUser
): Promise<UserResult> {
    try {
        const raw = await zitadelService.getFmPermissions(user.userId);
        if (!raw) return {...user, action: 'skipped'};

        const config = parsePermissionConfig(raw);
        if (!config && !isLegacyPermissionConfig(raw)) {
            return {...user, action: 'error', error: 'invalid fm_permissions'};
        }

        const builtIn = config
            ? builtInMatch(config)
            : legacyBuiltInMatch(raw as LegacyPermissionConfig);
        if (builtIn) {
            const role = BUILT_IN_ROLE_KEYS[builtIn];
            if (COMMIT) {
                await zitadelService.ensureProjectRoles(user.userId, [
                    'fleet-user',
                    role
                ]);
                await writeMigrationAudit(
                    tenantId,
                    user,
                    'migration.built_in_role_granted',
                    {role}
                );
            }
            return {
                ...user,
                action: COMMIT ? 'granted-built-in' : 'would-grant-built-in',
                role
            };
        }

        const scopedGroups = config
            ? await buildScopedStatementGroups(tenantId, config)
            : buildLegacyScopedStatementGroups(raw as LegacyPermissionConfig);
        if (scopedGroups.length === 0) return {...user, action: 'skipped'};

        if (!COMMIT) {
            return {
                ...user,
                action: 'would-migrate-custom',
                personaCount: scopedGroups.length,
                assignmentCount: scopedGroups.length
            };
        }

        await zitadelService.ensureProjectRoles(user.userId, ['fleet-user']);
        let assignmentCount = 0;
        const sourceHash = stableHash(config ?? raw, 10);
        for (const [index, group] of scopedGroups.entries()) {
            const result = await upsertPersonaAndAssignment(
                tenantId,
                user,
                sourceHash,
                index,
                group
            );
            if (result.insertedAssignment) assignmentCount++;
        }
        await writeMigrationAudit(
            tenantId,
            user,
            'migration.custom_personas_attached',
            {personaCount: scopedGroups.length, assignmentCount, sourceHash}
        );

        return {
            ...user,
            action: 'migrated-custom',
            personaCount: scopedGroups.length,
            assignmentCount
        };
    } catch (err) {
        return {
            ...user,
            action: 'error',
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

async function main() {
    if (!zitadelService.isAvailable()) {
        console.error('ERROR: Zitadel not configured (.fleet-managerrc)');
        process.exit(2);
    }
    if (COMMIT && !zitadelService.isManagementApiAvailable()) {
        console.error('ERROR: Zitadel Management API not available');
        process.exit(2);
    }

    await store.initDatabase(configRc.internalStorage);
    const tenantId = await resolveTenantId();
    const users = await listAllUsers();
    const results: UserResult[] = [];
    for (const user of users) results.push(await migrateUser(tenantId, user));

    const summary = {
        tenantId,
        mode: COMMIT ? 'commit' : 'dry-run',
        total: results.length,
        skipped: results.filter((r) => r.action === 'skipped').length,
        builtIn: results.filter(
            (r) =>
                r.action === 'would-grant-built-in' ||
                r.action === 'granted-built-in'
        ).length,
        custom: results.filter(
            (r) =>
                r.action === 'would-migrate-custom' ||
                r.action === 'migrated-custom'
        ).length,
        errors: results.filter((r) => r.action === 'error').length
    };

    if (OUTPUT === 'json') {
        console.log(JSON.stringify({summary, users: results}, null, 2));
    } else {
        console.log('='.repeat(60));
        console.log('fm_permissions → personas migration');
        console.log('='.repeat(60));
        console.log(`Tenant:       ${tenantId}`);
        console.log(`Mode:         ${summary.mode}`);
        console.log(`Users:        ${summary.total}`);
        console.log(`Built-ins:    ${summary.builtIn}`);
        console.log(`Custom:       ${summary.custom}`);
        console.log(`Skipped:      ${summary.skipped}`);
        console.log(`Errors:       ${summary.errors}`);
        for (const r of results.filter((r) => r.action === 'error')) {
            console.log(`ERROR ${r.userName} (${r.userId}): ${r.error}`);
        }
    }

    process.exit(summary.errors === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(2);
});
