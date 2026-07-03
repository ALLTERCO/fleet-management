// Shared DB-row → LoadedAlertRule mapper. Used by AlertEngine (live rule
// cache) and AlertComponent.Rule.Preview so a schema change touches one
// place instead of two.

import {
    ALERT_CONDITION_FAMILIES,
    ALERT_KIND_TO_FAMILY,
    type AlertConditionFamily,
    type AlertSeverity,
    publicAlertRuleKind,
    type ScopeSelector,
    type StoredAlertRuleKind
} from '../../types/api/alert';
import {publicScopeSelector} from '../alertRuleModel';
import type {LoadedAlertRule} from './types';

export interface RuleRowShape {
    id: number;
    organization_id: string;
    name: string;
    kind: StoredAlertRuleKind;
    severity: AlertSeverity;
    scope: ScopeSelector | Record<string, unknown> | null;
    dedupe_window_sec: number;
    cooldown_sec: number;
    owner_user_id: string | null;
    summary_template: string | null;
    message_template: string | null;
    auto_resolve: boolean;
    config: Record<string, unknown> | null;
    destination_group_ids: unknown;
    destination_channel_ids: unknown;
    group_by: string[] | null;
    delivery_mode: string | null;
    digest_window_minutes: number | null;
    runbook_url: string | null;
    template_id: number | null;
    condition_family: string | null;
    condition_subkind: string | null;
    labels_template: Record<string, unknown> | null;
}

function cloneRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return structuredClone(value) as Record<string, unknown>;
}

function toIntArray(value: unknown): number[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) =>
                typeof entry === 'number' ? entry : Number(String(entry))
            )
            .filter(
                (entry): entry is number =>
                    Number.isInteger(entry) && Number.isFinite(entry)
            )
            .sort((a, b) => a - b);
    }
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/^\{|\}$/g, '');
        if (!normalized) return [];
        return normalized
            .split(',')
            .map((entry) => Number(entry.trim()))
            .filter(
                (entry): entry is number =>
                    Number.isInteger(entry) && Number.isFinite(entry)
            )
            .sort((a, b) => a - b);
    }
    return [];
}

export function rowToLoadedRule(row: RuleRowShape): LoadedAlertRule {
    const kind = publicAlertRuleKind(row.kind);
    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        kind,
        severity: row.severity,
        scope: publicScopeSelector(row.scope),
        dedupeWindowSec: Number(row.dedupe_window_sec ?? 0),
        cooldownSec: Number(row.cooldown_sec ?? 0),
        ownerUserId: row.owner_user_id,
        summaryTemplate: row.summary_template,
        messageTemplate: row.message_template,
        autoResolve: row.auto_resolve,
        config: cloneRecord(row.config),
        destinationGroupIds: toIntArray(row.destination_group_ids),
        destinationChannelIds: toIntArray(row.destination_channel_ids),
        groupBy: Array.isArray(row.group_by)
            ? row.group_by.map((v) => String(v))
            : null,
        deliveryMode: row.delivery_mode === 'digest' ? 'digest' : 'instant',
        digestWindowMinutes:
            typeof row.digest_window_minutes === 'number' &&
            row.digest_window_minutes >= 1
                ? row.digest_window_minutes
                : null,
        runbookUrl:
            typeof row.runbook_url === 'string' && row.runbook_url.length > 0
                ? row.runbook_url
                : null,
        templateId:
            typeof row.template_id === 'number' ? row.template_id : null,
        conditionFamily: pickConditionFamily(row),
        conditionSubkind:
            typeof row.condition_subkind === 'string' &&
            row.condition_subkind.length > 0
                ? row.condition_subkind
                : ALERT_KIND_TO_FAMILY[kind].subkind,
        labelsTemplate: cloneRecord(row.labels_template)
    };
}

// Fall back to ALERT_KIND_TO_FAMILY when column is null (pre-6525 rows).
function pickConditionFamily(row: RuleRowShape): AlertConditionFamily {
    const raw = row.condition_family;
    if (
        typeof raw === 'string' &&
        (ALERT_CONDITION_FAMILIES as readonly string[]).includes(raw)
    ) {
        return raw as AlertConditionFamily;
    }
    return ALERT_KIND_TO_FAMILY[publicAlertRuleKind(row.kind)].family;
}
