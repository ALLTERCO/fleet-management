// PostgresResolverDb — concrete ResolverDb against organization.* tables.
// Tables defined in 6112_authz_tables.sql.

import log4js from 'log4js';
import * as store from '../PostgresProvider';
import {loadAuthzConfig} from './config';
import type {AssignmentRow, PersonaRow, ResolverDb} from './resolver';
import type {Scope} from './types';

const logger = log4js.getLogger('authz-db');

export interface PersonaDbRow {
    id: string;
    key: string;
    statements: unknown;
    version: number;
    is_system_managed: boolean;
}

interface AssignmentDbRow {
    id: string;
    subject_type: 'user' | 'user_group';
    subject_id: string;
    persona_id: string;
    scope: unknown;
    expires_at: string | null;
    created_by: string | null;
}

// Self-heal: drop bad statements and log instead of throwing so the resolver
// keeps working when legacy data slips past the schema.
export function toPersonaRow(row: PersonaDbRow): PersonaRow {
    if (!Array.isArray(row.statements)) {
        logger.warn(
            'persona %s has non-array statements; treating as empty',
            row.id
        );
        return {
            id: row.id,
            key: row.key,
            statements: [],
            version: row.version,
            is_system_managed: row.is_system_managed
        };
    }
    const statements: PersonaRow['statements'] = [];
    for (let i = 0; i < row.statements.length; i++) {
        const s: any = row.statements[i];
        if (!Array.isArray(s?.actions) || !Array.isArray(s?.resource_types)) {
            logger.warn(
                'persona %s statement %d: actions/resource_types not arrays — dropped',
                row.id,
                i
            );
            continue;
        }
        // Fail closed: drop statements with unknown effect rather than
        // contributing them as Allow.
        if (s.effect !== 'Allow' && s.effect !== 'Deny') {
            logger.warn(
                'persona %s statement %d: effect=%s — dropped',
                row.id,
                i,
                JSON.stringify(s.effect)
            );
            continue;
        }
        const effect: 'Allow' | 'Deny' = s.effect;
        statements.push({
            actions: s.actions,
            notActions: Array.isArray(s.not_actions)
                ? s.not_actions
                : undefined,
            resourceTypes: s.resource_types,
            notResourceTypes: Array.isArray(s.not_resource_types)
                ? s.not_resource_types
                : undefined,
            effect,
            condition: s.condition,
            // Scope lives on assignment; overwritten when attached.
            scope: {all: true} as Scope
        });
    }
    return {
        id: row.id,
        key: row.key,
        statements,
        version: row.version,
        is_system_managed: row.is_system_managed
    };
}

function toAssignmentRow(row: AssignmentDbRow): AssignmentRow {
    return {
        id: row.id,
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        persona_id: row.persona_id,
        scope: (row.scope ?? {all: true}) as Scope,
        expires_at: row.expires_at,
        created_by: row.created_by
    };
}

export class PostgresResolverDb implements ResolverDb {
    async getSystemPersonas(keys: string[]): Promise<PersonaRow[]> {
        if (keys.length === 0) return [];
        const rows = await store.queryRows<PersonaDbRow>(
            `SELECT id::text, key, statements, version, is_system_managed
               FROM organization.personas
              WHERE is_system_managed = true
                AND key = ANY($1::text[])`,
            [keys]
        );
        return rows.map(toPersonaRow);
    }

    async getDurableTenantVersion(tenantId: string): Promise<number> {
        const rows = await store.queryRows<{authz_version: string}>(
            `SELECT authz_version::text
               FROM organization.profile
              WHERE id = $1`,
            [tenantId]
        );
        if (rows.length === 0) return 0;
        const v = Number.parseInt(rows[0].authz_version, 10);
        return Number.isFinite(v) ? v : 0;
    }

    async getGroupsForUser(
        userId: string,
        tenantId: string
    ): Promise<string[]> {
        const depthMax = loadAuthzConfig().groupDepthMax;
        const rows = await store.queryRows<{id: string}>(
            `WITH RECURSIVE chain(id, parent_group_id, depth) AS (
                 SELECT g.id, g.parent_group_id, 0
                   FROM organization.user_group_memberships m
                   JOIN organization.user_groups g ON g.id = m.group_id
                  WHERE m.user_id = $1
                    AND g.tenant_id = $2
                 UNION
                 SELECT g.id, g.parent_group_id, c.depth + 1
                   FROM organization.user_groups g
                   JOIN chain c ON c.parent_group_id = g.id
                  WHERE g.tenant_id = $2 AND c.depth < $3
             )
             SELECT id::text FROM chain`,
            [userId, tenantId, depthMax]
        );
        return rows.map((r) => r.id);
    }

    async markAssignmentsUsed(
        tenantId: string,
        assignmentIds: string[]
    ): Promise<void> {
        if (assignmentIds.length === 0) return;
        // Defense in depth — block cross-tenant writes if caller misuses.
        await store.queryRows(
            `UPDATE organization.assignments
                SET last_used_at = now()
              WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
            [assignmentIds, tenantId]
        );
    }

    async getAssignmentsForSubjects(
        tenantId: string,
        subjects: Array<{type: 'user' | 'user_group'; id: string}>
    ): Promise<AssignmentRow[]> {
        if (subjects.length === 0) return [];
        const userIds = subjects
            .filter((s) => s.type === 'user')
            .map((s) => s.id);
        const groupIds = subjects
            .filter((s) => s.type === 'user_group')
            .map((s) => s.id);
        const rows = await store.queryRows<AssignmentDbRow>(
            `SELECT id::text,
                    subject_type,
                    subject_id::text,
                    persona_id::text,
                    scope,
                    expires_at::text,
                    created_by::text
               FROM organization.assignments
              WHERE tenant_id = $1
                AND (expires_at IS NULL OR expires_at > now())
                AND (
                  (subject_type = 'user' AND subject_id = ANY($2::text[]))
                  OR
                  (subject_type = 'user_group' AND subject_id = ANY($3::text[]))
                )`,
            [tenantId, userIds, groupIds]
        );
        return rows.map(toAssignmentRow);
    }

    async getPersonasByIds(
        tenantId: string,
        personaIds: string[]
    ): Promise<PersonaRow[]> {
        if (personaIds.length === 0) return [];
        // Tenant or system-managed (NULL) only — block cross-tenant leak.
        const rows = await store.queryRows<PersonaDbRow>(
            `SELECT id::text, key, statements, version, is_system_managed
               FROM organization.personas
              WHERE id = ANY($1::uuid[])
                AND (tenant_id = $2 OR tenant_id IS NULL)`,
            [personaIds, tenantId]
        );
        return rows.map(toPersonaRow);
    }

    async getAllDeviceIdsForTenant(tenantId: string): Promise<string[]> {
        const rows = await store.queryRows<{id: string}>(
            `SELECT external_id AS id
               FROM device.list
              WHERE organization_id = $1
                AND external_id IS NOT NULL`,
            [tenantId]
        );
        return rows.map((r) => r.id);
    }

    async getDeviceIdsByLocations(
        tenantId: string,
        locationIds: number[]
    ): Promise<string[]> {
        if (locationIds.length === 0) return [];
        const rows = await store.queryRows<{id: string}>(
            `WITH RECURSIVE loc_tree AS (
                 SELECT id
                   FROM organization.locations
                  WHERE organization_id = $1
                    AND id = ANY($2::int[])
                 UNION ALL
                 SELECT child.id
                   FROM organization.locations child
                   JOIN loc_tree parent ON child.parent_location_id = parent.id
                  WHERE child.organization_id = $1
             )
             SELECT DISTINCT dl.external_id AS id
               FROM organization.location_assignments la
               JOIN device.list dl
                 ON dl.organization_id = la.organization_id
                AND dl.external_id = la.subject_id
              WHERE la.organization_id = $1
                AND la.subject_type = 'device'
                AND la.location_id IN (SELECT id FROM loc_tree)
                AND dl.external_id IS NOT NULL`,
            [tenantId, locationIds]
        );
        return rows.map((r) => r.id);
    }

    async getDeviceIdsByDeviceGroups(
        tenantId: string,
        deviceGroupIds: number[]
    ): Promise<string[]> {
        if (deviceGroupIds.length === 0) return [];
        const rows = await store.queryRows<{id: string}>(
            `SELECT DISTINCT gm.subject_id AS id
               FROM organization.group_members gm
              WHERE gm.organization_id = $1
                AND gm.subject_type = 'device'
                AND gm.group_id = ANY($2::int[])`,
            [tenantId, deviceGroupIds]
        );
        return rows.map((r) => r.id);
    }

    async getDeviceIdsByTags(
        tenantId: string,
        tags: string[]
    ): Promise<string[]> {
        if (tags.length === 0) return [];
        const rows = await store.queryRows<{id: string}>(
            `SELECT DISTINCT ta.subject_id AS id
               FROM organization.tag_assignments ta
               JOIN organization.tags t ON t.id = ta.tag_id
              WHERE ta.subject_type = 'device'
                AND t.key = ANY($1::text[])
                AND t.organization_id = $2`,
            [tags, tenantId]
        );
        return rows.map((r) => r.id);
    }
}
