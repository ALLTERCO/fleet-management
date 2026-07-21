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
        `WITH center AS (
             SELECT id, external_id
               FROM device.list
              WHERE organization_id = $1 AND external_id = $2
              LIMIT 1
         )
         SELECT r.id, r.name, r.kind, r.enabled, r.severity,
                EXISTS (
                    SELECT 1
                      FROM notifications.alert_rule_device_scope ds
                     WHERE ds.organization_id = r.organization_id
                       AND ds.rule_id = r.id
                       AND ds.device_id = center.id
                ) AS targets_center_device,
                ARRAY(
                    SELECT COALESCE(
                               center.external_id || '_' || es.entity_suffix,
                               es.virtual_entity_id
                           )
                      FROM notifications.alert_rule_entity_scope es
                     WHERE es.organization_id = r.organization_id
                       AND es.rule_id = r.id
                       AND (
                           (es.device_id = center.id
                            AND center.external_id || '_' || es.entity_suffix =
                                ANY($3::text[]))
                           OR es.virtual_entity_id = ANY($3::text[])
                       )
                     ORDER BY es.ordinal
                ) AS target_entity_ids
           FROM notifications.alert_rules r
           JOIN center ON TRUE
          WHERE r.organization_id = $1
            AND (
                EXISTS (
                    SELECT 1
                      FROM notifications.alert_rule_device_scope ds
                     WHERE ds.organization_id = r.organization_id
                       AND ds.rule_id = r.id
                       AND ds.device_id = center.id
                )
                OR EXISTS (
                    SELECT 1
                      FROM notifications.alert_rule_entity_scope es
                     WHERE es.organization_id = r.organization_id
                       AND es.rule_id = r.id
                       AND (
                           (es.device_id = center.id
                            AND center.external_id || '_' || es.entity_suffix =
                                ANY($3::text[]))
                           OR es.virtual_entity_id = ANY($3::text[])
                       )
                )
            )
          ORDER BY r.name ASC, r.id ASC
          LIMIT 200`,
        [input.organizationId, input.centerExternalId, centerEntityIds(input)]
    );
}

function alertRuleFactsFromRow(input: {
    input: RelationshipLoadInput;
    row: AlertRuleRow;
}): RelationshipAlertRuleFact[] {
    if (input.row.target_entity_ids.length > 0) {
        return input.row.target_entity_ids.map((entityId) =>
            alertRuleFact({...input, targetEntityId: entityId})
        );
    }
    if (!input.row.targets_center_device) return [];
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
