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

export interface AlertPresentationSettings {
    locale: string;
    timeZone: string;
}

type SubjectType = NonNullable<DeliveryPayload['source']>['subjectType'];

export function buildAlertPayload(
    rule: AlertPayloadRule,
    row: AlertPayloadRow,
    presentation?: AlertPresentationSettings
): DeliveryPayload {
    const base = buildBasePayload(rule, row, presentation);
    return applyRuleTemplates(base, rule);
}

function buildBasePayload(
    rule: AlertPayloadRule,
    row: AlertPayloadRow,
    presentation?: AlertPresentationSettings
): DeliveryPayload {
    const context = contextRecord(row.context);
    return {
        title: row.title,
        message: clearedMessage(row.state, context) ?? row.message,
        severity: row.severity,
        organizationId: row.organization_id,
        locale: presentation?.locale,
        timeZone: presentation?.timeZone,
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
            subjectId:
                row.source_subject_type === 'device' &&
                typeof context?.shellyID === 'string'
                    ? context.shellyID
                    : row.source_subject_id
        },
        labels: labelsFromContext(context),
        context
    };
}

const CLEARED_STATES: ReadonlySet<string> = new Set([
    'resolved',
    'cleared_unack',
    'cleared_ack'
]);

// The row keeps the text of its open; a clear stores its own reading beside it.
function clearedMessage(
    state: string,
    context: Record<string, unknown> | undefined
): string | undefined {
    if (!CLEARED_STATES.has(state)) return undefined;
    const message = contextRecord(
        context?.cleared as Record<string, unknown> | undefined
    )?.message;
    return typeof message === 'string' ? message : undefined;
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
