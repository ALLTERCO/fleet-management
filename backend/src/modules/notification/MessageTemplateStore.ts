// Sole owner of the notifications.fn_message_template_* SQL boundary. Maps rows
// to the MessageTemplate API shape. CRUD only — rendering lives in
// messageTemplateRender.ts.

import {toIso} from '../../rpc/pgRows';
import type {
    MessageTemplate,
    MessageTemplateBodies
} from '../../types/api/notification';
import * as PostgresProvider from '../PostgresProvider';
import {readObject} from './rowReaders';
import {
    isStandardMessageTemplateId,
    standardMessageTemplate
} from './standardMessageTemplate';

interface MessageTemplateRow {
    id: number;
    organization_id: string;
    name: string;
    description: string | null;
    bodies: MessageTemplateBodies | null;
    fallback_text: string;
    created_at: Date | string;
    updated_at: Date | string | null;
}

function rowToTemplate(row: MessageTemplateRow): MessageTemplate {
    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description ?? null,
        bodies: (readObject(row.bodies) as MessageTemplateBodies) ?? {},
        fallbackText: row.fallback_text,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}

export async function listMessageTemplates(
    organizationId: string
): Promise<MessageTemplate[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_message_template_list',
        {p_organization_id: organizationId}
    );
    return [
        standardMessageTemplate(organizationId),
        ...((result?.rows ?? []) as MessageTemplateRow[]).map(rowToTemplate)
    ];
}

export async function getMessageTemplate(
    organizationId: string,
    id: number
): Promise<MessageTemplate | null> {
    if (isStandardMessageTemplateId(id)) {
        return standardMessageTemplate(organizationId);
    }
    const result = await PostgresProvider.callMethod(
        'notifications.fn_message_template_get',
        {p_organization_id: organizationId, p_id: id}
    );
    const row = result?.rows?.[0] as MessageTemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
}

export interface MessageTemplateInput {
    name: string;
    description: string | null;
    bodies: MessageTemplateBodies;
    fallbackText: string;
}

export async function createMessageTemplate(
    organizationId: string,
    input: MessageTemplateInput
): Promise<MessageTemplate | null> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_message_template_create',
        {
            p_organization_id: organizationId,
            p_name: input.name,
            p_description: input.description,
            p_bodies: JSON.stringify(input.bodies ?? {}),
            p_fallback_text: input.fallbackText
        }
    );
    const row = result?.rows?.[0] as MessageTemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
}

export interface MessageTemplatePatch {
    name?: string;
    description?: string | null;
    bodies?: MessageTemplateBodies;
    fallbackText?: string;
}

export async function updateMessageTemplate(
    organizationId: string,
    id: number,
    patch: MessageTemplatePatch
): Promise<MessageTemplate | null> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_message_template_update',
        {
            p_organization_id: organizationId,
            p_id: id,
            p_name: patch.name ?? null,
            p_description:
                patch.description === undefined ? null : patch.description,
            p_clear_description: patch.description === null,
            p_bodies: patch.bodies ? JSON.stringify(patch.bodies) : null,
            p_fallback_text: patch.fallbackText ?? null
        }
    );
    const row = result?.rows?.[0] as MessageTemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
}

export async function deleteMessageTemplate(
    organizationId: string,
    id: number
): Promise<boolean> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_message_template_delete',
        {p_organization_id: organizationId, p_id: id}
    );
    return (result?.rows?.length ?? 0) > 0;
}
