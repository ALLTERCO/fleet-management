import {publicScopeSelector} from '../alertRuleModel';
import * as postgres from '../PostgresProvider';
import {centerEntityIds, requireOrganization} from './relationshipShared';
import type {
    AlertRuleRow,
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput
} from './relationshipTypes';
import type {RelationshipAlertRuleFact} from './types';

export async function loadIncludedAlertRuleFacts(
    input: RelationshipLoadInput
): Promise<RelationshipAlertRuleFact[]> {
    if (
        !input.includes.has('alerts') ||
        !input.organizationId ||
        !input.permissions.alertsRead
    ) {
        return [];
    }
    const rows = await queryDirectAlertRules(requireOrganization(input));
    return rows.flatMap((row) => alertRuleFactsFromRow({input, row}));
}

export async function queryDirectAlertRules(
    input: OrganizationRelationshipLoadInput
): Promise<AlertRuleRow[]> {
    return await postgres.queryRows<AlertRuleRow>(
        `SELECT id, name, kind, enabled, severity, scope
           FROM notifications.alert_rules
          WHERE organization_id = $1
            AND (
                scope @> jsonb_build_object('deviceIds', jsonb_build_array($2::text))
                OR EXISTS (
                    SELECT 1
                      FROM jsonb_array_elements_text(
                          COALESCE(scope->'componentIds', '[]'::jsonb) ||
                          COALESCE(scope->'entityIds', '[]'::jsonb)
                      ) component_id
                     WHERE component_id = ANY($3::text[])
                )
            )
          ORDER BY name ASC, id ASC
          LIMIT 200`,
        [input.organizationId, input.centerExternalId, centerEntityIds(input)]
    );
}

function alertRuleFactsFromRow(input: {
    input: RelationshipLoadInput;
    row: AlertRuleRow;
}): RelationshipAlertRuleFact[] {
    const scope = safeAlertScope(input.row.scope);
    const componentIds = scope.componentIds?.filter((entityId) =>
        centerEntityIds(input.input).includes(entityId)
    );
    if (componentIds && componentIds.length > 0) {
        return componentIds.map((entityId) =>
            alertRuleFact({...input, targetEntityId: entityId})
        );
    }
    if (!scope.deviceIds?.includes(input.input.centerExternalId)) return [];
    return [alertRuleFact(input)];
}

function alertRuleFact(input: {
    input: RelationshipLoadInput;
    row: AlertRuleRow;
    targetEntityId?: string;
}): RelationshipAlertRuleFact {
    return {
        id: input.row.id,
        label: input.row.name,
        enabled: input.row.enabled,
        severity: input.row.severity,
        kind: input.row.kind,
        targetExternalId: input.input.centerExternalId,
        targetEntityId: input.targetEntityId
    };
}

function safeAlertScope(
    scope: unknown
): ReturnType<typeof publicScopeSelector> {
    try {
        return publicScopeSelector(scope);
    } catch {
        return {};
    }
}
