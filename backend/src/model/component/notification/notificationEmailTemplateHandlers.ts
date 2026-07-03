// Email template library CRUD.

import {
    authzAuditActor,
    authzAuditWriter
} from '../../../modules/authz/audit/AuthzAuditWriter';
import {
    enforceEmailAttachmentLimit,
    parseEmailAttachments
} from '../../../modules/delivery/emailAttachments';
import * as PostgresProvider from '../../../modules/PostgresProvider';
import {translatePgError} from '../../../rpc/dbErrors';
import {toIso} from '../../../rpc/pgRows';
import RpcError from '../../../rpc/RpcError';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import {
    type EmailAttachment,
    type EmailTemplate,
    NOTIFICATION_EMAIL_TEMPLATE_CREATE_PARAMS_SCHEMA,
    NOTIFICATION_EMAIL_TEMPLATE_DELETE_PARAMS_SCHEMA,
    NOTIFICATION_EMAIL_TEMPLATE_GET_PARAMS_SCHEMA,
    NOTIFICATION_EMAIL_TEMPLATE_LIST_PARAMS_SCHEMA,
    NOTIFICATION_EMAIL_TEMPLATE_UPDATE_PARAMS_SCHEMA
} from '../../../types/api/notification';
import type CommandSender from '../../CommandSender';

interface EmailTemplateRow {
    id: number;
    organization_id: string;
    name: string;
    description: string | null;
    subject_template: string | null;
    html_template: string | null;
    text_template: string | null;
    attachments: unknown;
    created_at: Date | string;
    updated_at: Date | string | null;
    total?: number | string;
}

function rowToEmailTemplate(row: EmailTemplateRow): EmailTemplate {
    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description,
        subjectTemplate: row.subject_template,
        htmlTemplate: row.html_template,
        textTemplate: row.text_template,
        attachments: parseEmailAttachments(row.attachments),
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
        updatedAt: toIso(row.updated_at)
    };
}

async function fetchEmailTemplateRow(
    organizationId: string,
    id: number
): Promise<EmailTemplateRow | undefined> {
    const res = await PostgresProvider.callMethod(
        'notifications.fn_email_template_get',
        {p_organization_id: organizationId, p_id: id}
    );
    return res?.rows?.[0] as EmailTemplateRow | undefined;
}

export async function emailTemplateList(
    params: unknown,
    sender: CommandSender
): Promise<{
    items: EmailTemplate[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}> {
    const p = validateOrThrow<{
        organizationId?: string;
        limit: number;
        offset: number;
    }>(params, NOTIFICATION_EMAIL_TEMPLATE_LIST_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    try {
        const res = await PostgresProvider.callMethod(
            'notifications.fn_email_template_list',
            {
                p_organization_id: orgId,
                p_limit: p.limit,
                p_offset: p.offset
            }
        );
        const rows = (res?.rows ?? []) as EmailTemplateRow[];
        const total = rows.length > 0 ? Number(rows[0].total ?? 0) : 0;
        const items = rows.map(rowToEmailTemplate);
        return {
            items,
            total,
            limit: p.limit,
            offset: p.offset,
            has_more: p.offset + items.length < total
        };
    } catch (err: unknown) {
        throw translatePgError(err, 'Notification.EmailTemplate.List');
    }
}

export async function emailTemplateGet(
    params: unknown,
    sender: CommandSender
): Promise<EmailTemplate> {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_EMAIL_TEMPLATE_GET_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);
    const row = await fetchEmailTemplateRow(orgId, p.id);
    if (!row) throw RpcError.NotFound('email_template', p.id);
    return rowToEmailTemplate(row);
}

export async function emailTemplateCreate(
    params: unknown,
    sender: CommandSender
): Promise<EmailTemplate> {
    const p = validateOrThrow<{
        organizationId?: string;
        name: string;
        description?: string;
        subjectTemplate?: string;
        htmlTemplate?: string;
        textTemplate?: string;
        attachments?: EmailAttachment[];
    }>(params, NOTIFICATION_EMAIL_TEMPLATE_CREATE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    if (!p.subjectTemplate && !p.htmlTemplate && !p.textTemplate) {
        throw RpcError.Domain('ValidationFailed', {
            message:
                'At least one of subjectTemplate / htmlTemplate / textTemplate is required',
            field: 'subjectTemplate'
        });
    }
    enforceEmailAttachmentLimit(p.attachments);
    try {
        const res = await PostgresProvider.callMethod(
            'notifications.fn_email_template_create',
            {
                p_organization_id: orgId,
                p_name: p.name,
                p_description: p.description ?? null,
                p_subject_template: p.subjectTemplate ?? null,
                p_html_template: p.htmlTemplate ?? null,
                p_text_template: p.textTemplate ?? null,
                p_attachments: JSON.stringify(p.attachments ?? [])
            }
        );
        const row = res?.rows?.[0] as EmailTemplateRow | undefined;
        if (!row) {
            throw RpcError.OperationFailed(
                'Notification.EmailTemplate.Create',
                'no row returned'
            );
        }
        await authzAuditWriter.writeNotificationTemplateEvent({
            tenantId: orgId,
            actorId: authzAuditActor(sender.getUser?.()),
            operation: 'create',
            templateId: row.id,
            name: p.name
        });
        return rowToEmailTemplate(row);
    } catch (err: unknown) {
        throw translatePgError(err, 'Notification.EmailTemplate.Create');
    }
}

export async function emailTemplateUpdate(
    params: unknown,
    sender: CommandSender
): Promise<EmailTemplate> {
    const p = validateOrThrow<{
        organizationId?: string;
        id: number;
        name?: string;
        description?: string | null;
        subjectTemplate?: string | null;
        htmlTemplate?: string | null;
        textTemplate?: string | null;
        attachments?: EmailAttachment[];
    }>(params, NOTIFICATION_EMAIL_TEMPLATE_UPDATE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    enforceEmailAttachmentLimit(p.attachments);
    try {
        const res = await PostgresProvider.callMethod(
            'notifications.fn_email_template_update',
            {
                p_organization_id: orgId,
                p_id: p.id,
                p_name: p.name ?? null,
                p_description:
                    p.description === null ? null : (p.description ?? null),
                p_subject_template:
                    p.subjectTemplate === null
                        ? null
                        : (p.subjectTemplate ?? null),
                p_html_template:
                    p.htmlTemplate === null ? null : (p.htmlTemplate ?? null),
                p_text_template:
                    p.textTemplate === null ? null : (p.textTemplate ?? null),
                p_attachments: p.attachments
                    ? JSON.stringify(p.attachments)
                    : null,
                p_clear_description: p.description === null,
                p_clear_subject_template: p.subjectTemplate === null,
                p_clear_html_template: p.htmlTemplate === null,
                p_clear_text_template: p.textTemplate === null
            }
        );
        const row = res?.rows?.[0] as EmailTemplateRow | undefined;
        if (!row) throw RpcError.NotFound('email_template', p.id);
        await authzAuditWriter.writeNotificationTemplateEvent({
            tenantId: orgId,
            actorId: authzAuditActor(sender.getUser?.()),
            operation: 'update',
            templateId: row.id,
            name: p.name ?? undefined
        });
        return rowToEmailTemplate(row);
    } catch (err: unknown) {
        if (err instanceof RpcError) throw err;
        throw translatePgError(err, 'Notification.EmailTemplate.Update');
    }
}

export async function emailTemplateDelete(
    params: unknown,
    sender: CommandSender
): Promise<{deleted: boolean}> {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_EMAIL_TEMPLATE_DELETE_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);
    try {
        const res = await PostgresProvider.callMethod(
            'notifications.fn_email_template_delete',
            {p_organization_id: orgId, p_id: p.id}
        );
        const count = Number(PostgresProvider.extractScalar(res?.rows) ?? 0);
        if (count > 0) {
            await authzAuditWriter.writeNotificationTemplateEvent({
                tenantId: orgId,
                actorId: authzAuditActor(sender.getUser?.()),
                operation: 'delete',
                templateId: p.id
            });
        }
        return {deleted: count > 0};
    } catch (err: unknown) {
        throw translatePgError(err, 'Notification.EmailTemplate.Delete');
    }
}
