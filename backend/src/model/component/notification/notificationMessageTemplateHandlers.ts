// Multi-channel message template CRUD. Owns the Notification.Template.* RPCs;
// row mapping + the SQL boundary live in MessageTemplateStore. A rule or an
// endpoint can reference one of these by id.

import {normalizeOptionalText} from '../../../modules/alertRuleModel';
import {
    createMessageTemplate,
    deleteMessageTemplate,
    getMessageTemplate,
    listMessageTemplates,
    updateMessageTemplate
} from '../../../modules/notification/MessageTemplateStore';
import {validateMessageTemplateBodies} from '../../../modules/notification/messageTemplateRender';
import {invalidateMessageTemplate} from '../../../modules/notification/messageTemplateResolver';
import {asOperationFailed} from '../../../rpc/operationError';
import RpcError from '../../../rpc/RpcError';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import {
    MESSAGE_TEMPLATE_CREATE_PARAMS_SCHEMA,
    MESSAGE_TEMPLATE_DELETE_PARAMS_SCHEMA,
    MESSAGE_TEMPLATE_GET_PARAMS_SCHEMA,
    MESSAGE_TEMPLATE_LIST_PARAMS_SCHEMA,
    MESSAGE_TEMPLATE_UPDATE_PARAMS_SCHEMA,
    type MessageTemplate,
    type MessageTemplateBodies
} from '../../../types/api/notification';
import type CommandSender from '../../CommandSender';

function requireName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw RpcError.InvalidParams('Template name cannot be empty');
    return trimmed;
}

export async function messageTemplateList(
    params: unknown,
    sender: CommandSender
): Promise<{items: MessageTemplate[]}> {
    const p = validateOrThrow<{organizationId?: string}>(
        params,
        MESSAGE_TEMPLATE_LIST_PARAMS_SCHEMA
    );
    const organizationId = requireOrganizationId(sender, p);
    try {
        return {items: await listMessageTemplates(organizationId)};
    } catch (err: unknown) {
        throw asOperationFailed('Notification.Template.List', err);
    }
}

export async function messageTemplateGet(
    params: unknown,
    sender: CommandSender
): Promise<MessageTemplate> {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        MESSAGE_TEMPLATE_GET_PARAMS_SCHEMA
    );
    const organizationId = requireOrganizationId(sender, p);
    try {
        const template = await getMessageTemplate(organizationId, p.id);
        if (!template) throw RpcError.NotFound('message_template', p.id);
        return template;
    } catch (err: unknown) {
        throw asOperationFailed('Notification.Template.Get', err);
    }
}

export async function messageTemplateCreate(
    params: unknown,
    sender: CommandSender
): Promise<MessageTemplate> {
    const p = validateOrThrow<{
        organizationId?: string;
        name: string;
        description?: string | null;
        bodies?: MessageTemplateBodies;
        fallbackText: string;
    }>(params, MESSAGE_TEMPLATE_CREATE_PARAMS_SCHEMA);
    const organizationId = requireOrganizationId(sender, p);
    validateMessageTemplateBodies(p.bodies);
    try {
        const created = await createMessageTemplate(organizationId, {
            name: requireName(p.name),
            description: normalizeOptionalText(p.description),
            bodies: p.bodies ?? {},
            fallbackText: p.fallbackText
        });
        if (!created) {
            throw RpcError.OperationFailed('Notification.Template.Create');
        }
        return created;
    } catch (err: unknown) {
        throw asOperationFailed('Notification.Template.Create', err);
    }
}

export async function messageTemplateUpdate(
    params: unknown,
    sender: CommandSender
): Promise<MessageTemplate> {
    const p = validateOrThrow<{
        organizationId?: string;
        id: number;
        patch: {
            name?: string;
            description?: string | null;
            bodies?: MessageTemplateBodies;
            fallbackText?: string;
        };
    }>(params, MESSAGE_TEMPLATE_UPDATE_PARAMS_SCHEMA);
    const organizationId = requireOrganizationId(sender, p);
    if (p.patch.bodies) validateMessageTemplateBodies(p.patch.bodies);
    try {
        const updated = await updateMessageTemplate(organizationId, p.id, {
            name:
                p.patch.name !== undefined
                    ? requireName(p.patch.name)
                    : undefined,
            description:
                p.patch.description === undefined
                    ? undefined
                    : normalizeOptionalText(p.patch.description),
            bodies: p.patch.bodies,
            fallbackText: p.patch.fallbackText
        });
        if (!updated) throw RpcError.NotFound('message_template', p.id);
        invalidateMessageTemplate(organizationId, p.id);
        return updated;
    } catch (err: unknown) {
        throw asOperationFailed('Notification.Template.Update', err);
    }
}

// The delete SQL refuses (foreign_key_violation) when a rule or endpoint still
// points at the template; surface that as a clear client error, not a 500.
function isStillInUse(err: unknown): boolean {
    return (err as {code?: string} | null)?.code === '23503';
}

export async function messageTemplateDelete(
    params: unknown,
    sender: CommandSender
): Promise<{deleted: boolean}> {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        MESSAGE_TEMPLATE_DELETE_PARAMS_SCHEMA
    );
    const organizationId = requireOrganizationId(sender, p);
    try {
        const deleted = await deleteMessageTemplate(organizationId, p.id);
        invalidateMessageTemplate(organizationId, p.id);
        return {deleted};
    } catch (err: unknown) {
        if (isStillInUse(err)) {
            throw RpcError.InvalidParams(
                'Template is still in use by a rule or endpoint and cannot be deleted'
            );
        }
        throw asOperationFailed('Notification.Template.Delete', err);
    }
}
