import * as postgres from '../PostgresProvider';

interface ScopeRow {
    rule_id: number;
    scope: Record<string, unknown>;
}

export interface StoredRuleScopeRow {
    id?: number;
    scope?: unknown;
}

export async function hydratePublicRuleScopes<T extends StoredRuleScopeRow>(
    organizationId: string,
    rows: T[],
    txId?: number
): Promise<T[]> {
    const ids = rows
        .map((row) => row.id)
        .filter((id): id is number => typeof id === 'number');
    if (ids.length === 0) return rows;

    const result = await postgres.callMethod(
        'notifications.fn_alert_rule_scopes_public',
        {p_organization_id: organizationId, p_rule_ids: ids},
        txId
    );
    const scopes = new Map(
        ((result?.rows ?? []) as ScopeRow[]).map((row) => [
            row.rule_id,
            row.scope
        ])
    );
    for (const row of rows) {
        if (row.id !== undefined && scopes.has(row.id)) {
            (row as StoredRuleScopeRow).scope = scopes.get(row.id) ?? {};
        }
    }
    return rows;
}

export async function replaceRuleSubjectScope(
    organizationId: string,
    ruleId: number,
    scope: {
        deviceIds?: readonly string[];
        componentIds?: readonly string[];
    },
    txId?: number
): Promise<void> {
    await postgres.callMethod(
        'notifications.fn_alert_rule_subject_scope_replace',
        {
            p_organization_id: organizationId,
            p_rule_id: ruleId,
            p_scope: JSON.stringify({
                deviceIds: scope.deviceIds ?? [],
                componentIds: scope.componentIds ?? []
            })
        },
        txId
    );
}
