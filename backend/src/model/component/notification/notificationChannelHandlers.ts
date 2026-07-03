// Notification channels plus alert-template / email rendering and preview.

import {
    buildDeliveryContext,
    sampleTemplateContext
} from '../../../modules/alert/templateContext';
import {
    renderTemplate,
    TEMPLATE_TOKENS
} from '../../../modules/alert/templateRenderer';
import {
    renderEmail,
    renderSubject
} from '../../../modules/delivery/adapters/emailTemplate';
import {probeAttachments} from '../../../modules/delivery/attachmentProbe';
import {parseEmailAttachments} from '../../../modules/delivery/emailAttachments';
import {resolveEmailTemplateConfig} from '../../../modules/delivery/emailTemplateResolver';
import type {DeliveryPayload} from '../../../modules/delivery/types';
import * as PostgresProvider from '../../../modules/PostgresProvider';
import {toIso} from '../../../rpc/pgRows';
import RpcError from '../../../rpc/RpcError';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import {
    type AlertRuleKind,
    type AlertScopeType,
    publicAlertScopeType,
    type StoredAlertScopeType
} from '../../../types/api/alert';
import {
    type EmailAttachment,
    NOTIFICATION_RENDER_EMAIL_PREVIEW_PARAMS_SCHEMA,
    NOTIFICATION_RENDER_TEMPLATE_PARAMS_SCHEMA
} from '../../../types/api/notification';
import type CommandSender from '../../CommandSender';

// Inline > emailTemplateId > channelId. Explicit inline fields always win.
async function resolvePreviewTemplates(
    orgId: string,
    p: {
        channelId?: number;
        emailTemplateId?: number;
        subjectTemplate?: string;
        htmlTemplate?: string;
        textTemplate?: string;
        attachments?: EmailAttachment[];
    }
): Promise<{
    subjectTemplate?: string;
    htmlTemplate?: string;
    textTemplate?: string;
    attachments: EmailAttachment[];
}> {
    let subjectTemplate = p.subjectTemplate;
    let htmlTemplate = p.htmlTemplate;
    let textTemplate = p.textTemplate;
    let attachments = p.attachments;

    if (p.emailTemplateId != null) {
        const merged = await resolveEmailTemplateConfig(
            {emailTemplateId: p.emailTemplateId},
            orgId
        );
        if (subjectTemplate === undefined) {
            subjectTemplate = merged.subjectTemplate as string | undefined;
        }
        if (htmlTemplate === undefined) {
            htmlTemplate = merged.htmlTemplate as string | undefined;
        }
        if (textTemplate === undefined) {
            textTemplate = merged.textTemplate as string | undefined;
        }
        if (attachments === undefined) {
            attachments = parseEmailAttachments(merged.attachments);
        }
    }

    if (
        p.channelId &&
        subjectTemplate === undefined &&
        htmlTemplate === undefined &&
        textTemplate === undefined &&
        attachments === undefined
    ) {
        const channel = await fetchEmailChannelTemplates(orgId, p.channelId);
        subjectTemplate = channel.subjectTemplate;
        htmlTemplate = channel.htmlTemplate;
        textTemplate = channel.textTemplate;
        attachments = channel.attachments;
    }

    return {
        subjectTemplate,
        htmlTemplate,
        textTemplate,
        attachments: attachments ?? []
    };
}

async function fetchEmailChannelTemplates(
    orgId: string,
    channelId: number
): Promise<{
    subjectTemplate?: string;
    htmlTemplate?: string;
    textTemplate?: string;
    attachments: EmailAttachment[];
}> {
    const res = await PostgresProvider.callMethod(
        'notifications.fn_channel_get',
        {p_organization_id: orgId, p_id: channelId}
    );
    const row = res?.rows?.[0] as
        | {provider?: string; config?: Record<string, unknown>}
        | undefined;
    if (!row) throw RpcError.NotFound('channel', channelId);
    if (row.provider !== 'email_smtp') {
        throw RpcError.InvalidParams(
            `RenderEmailPreview: channel ${channelId} is not an email_smtp channel`
        );
    }
    // Same precedence as delivery: library template first, inline overrides.
    const cfg = await resolveEmailTemplateConfig(row.config ?? {}, orgId);
    const str = (k: string) =>
        typeof cfg[k] === 'string' ? (cfg[k] as string) : undefined;
    return {
        subjectTemplate: str('subjectTemplate'),
        htmlTemplate: str('htmlTemplate'),
        textTemplate: str('textTemplate'),
        attachments: parseEmailAttachments(cfg.attachments)
    };
}

async function samplePayload(
    orgId: string,
    p: {
        sampleAlertId?: number;
        ruleKind?: AlertRuleKind;
        ruleName?: string;
    }
): Promise<DeliveryPayload> {
    if (p.sampleAlertId) {
        const res = await PostgresProvider.callMethod(
            'notifications.fn_alert_instance_get',
            {p_organization_id: orgId, p_id: p.sampleAlertId}
        );
        const row = res?.rows?.[0] as
            | {
                  id: number;
                  rule_id: number;
                  rule_kind: AlertRuleKind;
                  state: 'active' | 'acknowledged' | 'resolved';
                  severity: 'info' | 'warning' | 'critical';
                  source_subject_type: StoredAlertScopeType;
                  source_subject_id: string;
                  title: string;
                  message: string;
                  active_since: Date | string;
                  last_triggered_at: Date | string;
              }
            | undefined;
        if (!row) throw RpcError.NotFound('alert_instance', p.sampleAlertId);
        return {
            title: row.title,
            message: row.message,
            severity: row.severity,
            organizationId: orgId,
            alertId: row.id,
            ruleId: row.rule_id,
            ruleName: p.ruleName ?? 'Rule',
            ruleKind: row.rule_kind,
            state: row.state,
            firedAt: toIso(row.last_triggered_at) ?? '',
            activeSince: toIso(row.active_since) ?? '',
            source: {
                subjectType: publicAlertScopeType(row.source_subject_type),
                subjectId: row.source_subject_id
            }
        };
    }
    // Synthesized — same sample contexts the token catalog uses.
    const ctx = sampleTemplateContext(p.ruleKind, p.ruleName) as {
        alert: {
            id: number;
            title: string;
            message: string;
            severity: 'info' | 'warning' | 'critical';
            state: 'active' | 'acknowledged' | 'resolved';
            source: {type: AlertScopeType; id: string};
            firedAt: string;
            activeSince: string;
        };
        rule: {id: number; name: string; kind: AlertRuleKind};
    };
    return {
        title: ctx.alert.title,
        message: ctx.alert.message,
        severity: ctx.alert.severity,
        organizationId: orgId,
        alertId: ctx.alert.id,
        ruleId: ctx.rule.id,
        ruleName: ctx.rule.name,
        ruleKind: ctx.rule.kind,
        state: ctx.alert.state,
        firedAt: ctx.alert.firedAt,
        activeSince: ctx.alert.activeSince,
        source: {
            subjectType: ctx.alert.source.type,
            subjectId: ctx.alert.source.id
        }
    };
}

async function contextFromAlert(
    organizationId: string,
    alertId: number,
    ruleName: string | undefined
): Promise<Record<string, unknown>> {
    // One DB read + one mapping — same primitive the email preview uses.
    const payload = await samplePayload(organizationId, {
        sampleAlertId: alertId,
        ruleName
    });
    return buildDeliveryContext(payload);
}

export async function renderTemplateRpc(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        template: string;
        sampleAlertId?: number;
        ruleKind?: AlertRuleKind;
        ruleName?: string;
    }>(params, NOTIFICATION_RENDER_TEMPLATE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    const context = p.sampleAlertId
        ? await contextFromAlert(orgId, p.sampleAlertId, p.ruleName)
        : sampleTemplateContext(p.ruleKind, p.ruleName);

    const result = renderTemplate(p.template, context);
    return {
        rendered: result.rendered,
        missingTokens: result.missingTokens,
        truncated: result.truncated,
        tokens: [...TEMPLATE_TOKENS]
    };
}

export async function renderEmailPreview(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        channelId?: number;
        emailTemplateId?: number;
        subjectTemplate?: string;
        htmlTemplate?: string;
        textTemplate?: string;
        attachments?: EmailAttachment[];
        sampleAlertId?: number;
        ruleKind?: AlertRuleKind;
        ruleName?: string;
    }>(params, NOTIFICATION_RENDER_EMAIL_PREVIEW_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);

    const resolved = await resolvePreviewTemplates(orgId, p);
    const payload = await samplePayload(orgId, p);
    const rendered = renderEmail(
        payload,
        resolved.htmlTemplate,
        resolved.textTemplate
    );
    // Probe attachment URLs / asset refs in parallel so the UI can
    // flag broken logos before the operator saves the template.
    const probed = await probeAttachments(resolved.attachments, orgId);
    return {
        subject: renderSubject(payload, resolved.subjectTemplate),
        html: rendered.html,
        text: rendered.text,
        missingTokens: rendered.missingTokens,
        truncated: rendered.truncated,
        attachments: probed
    };
}
