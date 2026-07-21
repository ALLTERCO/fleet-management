// Org-scoped CRUD for organization.report_templates — saved report configs an
// org re-runs. Every query is scoped to the caller's organization.

import type {
    ReportTemplate,
    ReportTemplateKind
} from '../types/api/reporttemplate';
import * as postgres from './PostgresProvider';
import {jsonbParam} from './postgresJsonb';

export interface ReportTemplateRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    withTransaction?<T>(
        fn: (client: postgres.QueryTxClient) => Promise<T>
    ): Promise<T>;
}

const defaultDeps: ReportTemplateRepositoryDeps = {
    queryRows: postgres.queryRows,
    withTransaction: postgres.withQueryTransaction
};

interface TemplateRow {
    id: string;
    name: string;
    description: string | null;
    kind: ReportTemplateKind;
    params: Record<string, unknown>;
    sections_enabled: string[] | null;
    created_by: string | null;
    created_at: Date | string;
    updated_at: Date | string | null;
}

const COLUMNS = `id, name, description, kind,
    ui.fn_report_template_params_public(id, params) AS params,
    sections_enabled, created_by, created_at, updated_at`;

async function inTransaction<T>(
    deps: ReportTemplateRepositoryDeps,
    fn: (client: postgres.QueryTxClient) => Promise<T>
): Promise<T> {
    if (deps.withTransaction) return deps.withTransaction(fn);
    return fn({query: deps.queryRows} as postgres.QueryTxClient);
}

function asIso(value: Date | string | null): string | null {
    if (value === null) return null;
    return value instanceof Date ? value.toISOString() : String(value);
}

function toTemplate(row: TemplateRow): ReportTemplate {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind,
        params: row.params,
        sectionsEnabled: row.sections_enabled,
        createdBy: row.created_by,
        createdAt: asIso(row.created_at) ?? '',
        updatedAt: asIso(row.updated_at)
    };
}

export interface ReportTemplateCreateInput {
    name: string;
    description?: string | null;
    kind: ReportTemplateKind;
    params: Record<string, unknown>;
    sectionsEnabled?: string[] | null;
    createdBy?: string | null;
}

// Whether a case-insensitive name already exists for this org.
export async function reportTemplateNameExists(
    organizationId: string,
    name: string,
    deps: ReportTemplateRepositoryDeps = defaultDeps
): Promise<boolean> {
    const rows = await deps.queryRows(
        `SELECT 1 FROM organization.report_templates
          WHERE organization_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [organizationId, name]
    );
    return rows.length > 0;
}

export async function createReportTemplate(
    organizationId: string,
    input: ReportTemplateCreateInput,
    deps: ReportTemplateRepositoryDeps = defaultDeps
): Promise<ReportTemplate> {
    return inTransaction(deps, async (client) => {
        await client.query('SELECT organization.fn_profile_ensure($1)', [
            organizationId
        ]);
        const inserted = await client.query<{id: string}>(
            `INSERT INTO organization.report_templates
                (organization_id, name, description, kind, params,
                 sections_enabled, created_by)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
             RETURNING id`,
            [
                organizationId,
                input.name,
                input.description ?? null,
                input.kind,
                jsonbParam(input.params),
                input.sectionsEnabled ?? null,
                input.createdBy ?? null
            ]
        );
        const id = inserted[0]?.id;
        await client.query(
            'SELECT ui.fn_report_template_device_refs_replace($1, $2, $3::jsonb)',
            [organizationId, id, jsonbParam(input.params)]
        );
        const rows = await client.query<TemplateRow>(
            `SELECT ${COLUMNS} FROM organization.report_templates
              WHERE organization_id = $1 AND id = $2`,
            [organizationId, id]
        );
        return toTemplate(rows[0]);
    });
}

export interface ReportTemplateUpdateInput {
    name?: string;
    description?: string | null;
    params?: Record<string, unknown>;
    sectionsEnabled?: string[] | null;
}

// Patch the supplied fields of an org's template; returns the updated row or
// null when the id is unknown for this org. Org-scoped on the WHERE.
export async function updateReportTemplate(
    organizationId: string,
    id: string,
    patch: ReportTemplateUpdateInput,
    deps: ReportTemplateRepositoryDeps = defaultDeps
): Promise<ReportTemplate | null> {
    return inTransaction(deps, async (client) => {
        const sets: string[] = ['updated_at = NOW()'];
        const args: unknown[] = [organizationId, id];
        const add = (col: string, value: unknown) => {
            args.push(value);
            sets.push(`${col} = $${args.length}`);
        };
        if (patch.name !== undefined) add('name', patch.name);
        if (patch.description !== undefined) {
            add('description', patch.description);
        }
        if (patch.params !== undefined) {
            args.push(jsonbParam(patch.params));
            sets.push(`params = $${args.length}::jsonb`);
        }
        if (patch.sectionsEnabled !== undefined) {
            add('sections_enabled', patch.sectionsEnabled);
        }
        const updated = await client.query<{id: string}>(
            `UPDATE organization.report_templates SET ${sets.join(', ')}
              WHERE organization_id = $1 AND id = $2
              RETURNING id`,
            args
        );
        if (!updated[0]) return null;
        if (patch.params !== undefined) {
            await client.query(
                'SELECT ui.fn_report_template_device_refs_replace($1, $2, $3::jsonb)',
                [organizationId, id, jsonbParam(patch.params)]
            );
        }
        const rows = await client.query<TemplateRow>(
            `SELECT ${COLUMNS} FROM organization.report_templates
              WHERE organization_id = $1 AND id = $2`,
            [organizationId, id]
        );
        return rows[0] ? toTemplate(rows[0]) : null;
    });
}

export async function listReportTemplates(
    organizationId: string,
    deps: ReportTemplateRepositoryDeps = defaultDeps
): Promise<ReportTemplate[]> {
    const rows = await deps.queryRows<TemplateRow>(
        `SELECT ${COLUMNS} FROM organization.report_templates
          WHERE organization_id = $1 ORDER BY lower(name)`,
        [organizationId]
    );
    return rows.map(toTemplate);
}

export async function getReportTemplate(
    organizationId: string,
    id: string,
    deps: ReportTemplateRepositoryDeps = defaultDeps
): Promise<ReportTemplate | null> {
    const rows = await deps.queryRows<TemplateRow>(
        `SELECT ${COLUMNS} FROM organization.report_templates
          WHERE organization_id = $1 AND id = $2`,
        [organizationId, id]
    );
    return rows[0] ? toTemplate(rows[0]) : null;
}

export async function deleteReportTemplate(
    organizationId: string,
    id: string,
    deps: ReportTemplateRepositoryDeps = defaultDeps
): Promise<boolean> {
    const rows = await deps.queryRows<{id: string}>(
        `DELETE FROM organization.report_templates
          WHERE organization_id = $1 AND id = $2 RETURNING id`,
        [organizationId, id]
    );
    return rows.length > 0;
}
