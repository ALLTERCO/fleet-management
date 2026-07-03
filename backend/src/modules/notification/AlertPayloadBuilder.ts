import {buildDeliveryContext} from '../alert/templateContext';
import {renderTemplate} from '../alert/templateRenderer';
import type {DeliveryPayload} from '../delivery/types';

export interface AlertPayloadRule {
    id: number;
    name: string;
    summaryTemplate?: string | null;
    messageTemplate?: string | null;
    runbookUrl?: string | null;
}

export interface AlertPayloadRow {
    id: number;
    organization_id: string;
    rule_kind: string;
    state: string;
    severity: 'info' | 'warning' | 'critical';
    source_subject_type: string;
    source_subject_id: string;
    title: string;
    message: string;
    context?: Record<string, unknown> | null;
    active_since: string;
    last_triggered_at: string;
}

type SubjectType = NonNullable<DeliveryPayload['source']>['subjectType'];

export function buildAlertPayload(
    rule: AlertPayloadRule,
    row: AlertPayloadRow
): DeliveryPayload {
    const base = buildBasePayload(rule, row);
    return applyRuleTemplates(base, rule);
}

function buildBasePayload(
    rule: AlertPayloadRule,
    row: AlertPayloadRow
): DeliveryPayload {
    return {
        title: row.title,
        message: row.message,
        severity: row.severity,
        organizationId: row.organization_id,
        alertId: row.id,
        ruleId: rule.id,
        ruleName: rule.name,
        ruleKind: row.rule_kind,
        ruleRunbookUrl: rule.runbookUrl ?? null,
        state: row.state as DeliveryPayload['state'],
        firedAt: row.last_triggered_at,
        activeSince: row.active_since,
        source: {
            subjectType: row.source_subject_type as SubjectType,
            subjectId: row.source_subject_id
        },
        labels: labelsFromContext(row.context),
        context: contextRecord(row.context)
    };
}

function labelsFromContext(
    context: Record<string, unknown> | null | undefined
): Record<string, string> | undefined {
    const labels = contextRecord(context)?.labels;
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
        return undefined;
    }
    return Object.fromEntries(
        Object.entries(labels)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, value as string])
    );
}

function contextRecord(
    context: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return undefined;
    }
    return context;
}

function applyRuleTemplates(
    payload: DeliveryPayload,
    rule: AlertPayloadRule
): DeliveryPayload {
    if (!rule.summaryTemplate && !rule.messageTemplate) return payload;
    const context = buildDeliveryContext(payload);
    return {
        ...payload,
        title: rule.summaryTemplate
            ? renderTemplate(rule.summaryTemplate, context).rendered
            : payload.title,
        message: rule.messageTemplate
            ? renderTemplate(rule.messageTemplate, context).rendered
            : payload.message
    };
}
