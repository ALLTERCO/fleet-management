// Canonical alert payload — channel-agnostic structured form. Per-channel
// renderers (Phase 6) project this to Slack Block Kit, Teams Adaptive
// Card, email HTML+text, SMS short form, push JSON, etc. This module is
// the SoT mapping DeliveryPayload → CanonicalAlertPayload.

import type {AlertSeverity, AlertState} from '../../../types/api/alert';
import type {DeliveryPayload} from '../types';

export type CanonicalFieldType = 'text' | 'number' | 'duration' | 'url';

export interface CanonicalField {
    label: string;
    value: string;
    type?: CanonicalFieldType;
}

export type CanonicalActionStyle = 'primary' | 'danger' | 'default';

export interface CanonicalAction {
    /** Stable button id; receivers verify against an HMAC payload. */
    id: string;
    label: string;
    style?: CanonicalActionStyle;
    /** Optional URL for "open" actions; ack/snooze use the receiver callback. */
    url?: string;
}

export interface CanonicalLink {
    label: string;
    url: string;
}

export interface CanonicalAlertPayload {
    severity: AlertSeverity;
    state: AlertState;
    title: string;
    body: string;
    fields: CanonicalField[];
    actions: CanonicalAction[];
    links: CanonicalLink[];
    /** Free-form rule labels (key:value) for renderers that group by them. */
    labels: Record<string, string>;
    /** Evaluator context for renderers that surface the raw reading. */
    context: Record<string, unknown>;
    /** Source identification, surfaced as "Device: shelly-xx" etc. */
    source?: {subjectType: string; subjectId: string};
    /** ISO timestamp; renderers format per locale. */
    firedAt: string;
}

export function toCanonical(payload: DeliveryPayload): CanonicalAlertPayload {
    return {
        severity: payload.severity,
        state: payload.state,
        title: payload.title,
        body: payload.message,
        fields: deriveFields(payload),
        actions: deriveActions(payload),
        links: deriveLinks(payload),
        labels: payload.labels ?? {},
        context: payload.context ?? {},
        source: payload.source ?? undefined,
        firedAt: payload.firedAt
    };
}

function deriveFields(payload: DeliveryPayload): CanonicalField[] {
    const ctx = (payload.context ?? {}) as Record<string, unknown>;
    const out: CanonicalField[] = [];
    if (payload.source?.subjectId) {
        out.push({
            label: 'Device',
            value: payload.source.subjectId,
            type: 'text'
        });
    }
    if (typeof ctx.percent === 'number') {
        out.push({label: 'Percent', value: `${ctx.percent}%`, type: 'number'});
    }
    if (typeof ctx.current === 'number') {
        out.push({
            label: 'Current',
            value: String(ctx.current),
            type: 'number'
        });
    }
    if (typeof ctx.threshold === 'number') {
        out.push({
            label: 'Threshold',
            value: String(ctx.threshold),
            type: 'number'
        });
    }
    if (typeof ctx.component === 'string' && typeof ctx.field === 'string') {
        out.push({
            label: 'Source',
            value: `${ctx.component}.${ctx.field}`,
            type: 'text'
        });
    }
    if (typeof ctx.operator === 'string') {
        out.push({label: 'Operator', value: ctx.operator, type: 'text'});
    }
    return out;
}

function deriveActions(payload: DeliveryPayload): CanonicalAction[] {
    if (payload.alertId == null) return [];
    return [
        {id: `ack:${payload.alertId}`, label: 'Acknowledge', style: 'primary'},
        {id: `snooze:${payload.alertId}`, label: 'Snooze 1h'},
        {id: `resolve:${payload.alertId}`, label: 'Resolve', style: 'danger'}
    ];
}

function deriveLinks(payload: DeliveryPayload): CanonicalLink[] {
    const links: CanonicalLink[] = [];
    if (payload.ruleRunbookUrl) {
        links.push({label: 'Runbook', url: payload.ruleRunbookUrl});
    }
    return links;
}
