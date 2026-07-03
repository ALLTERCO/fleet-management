// Resolves config.emailTemplateId → subject/html/text/attachments from
// notifications.email_templates. Inline fields on the endpoint override
// the saved library values field-by-field.

import * as log4js from 'log4js';

const logger = log4js.getLogger('emailTemplateResolver');

interface EmailTemplateRow {
    id: number;
    organization_id: string;
    subject_template: string | null;
    html_template: string | null;
    text_template: string | null;
    attachments: unknown;
}

// Dynamic import keeps the Postgres/config module graph out of tests
// that DI a fake callMethod.
type CallMethod = (
    name: string,
    params: Record<string, unknown>
) => Promise<{rows?: unknown[]} | undefined>;

let _defaultCallMethod: CallMethod | undefined;
async function getDefaultCallMethod(): Promise<CallMethod> {
    if (!_defaultCallMethod) {
        const mod = await import('../PostgresProvider.js');
        _defaultCallMethod = mod.callMethod;
    }
    return _defaultCallMethod;
}

/** Merge saved library template into `config`; inline overrides win.
 *  No-op if emailTemplateId is missing / template not found in this org. */
export async function resolveEmailTemplateConfig(
    config: Record<string, unknown>,
    organizationId: string,
    callMethod?: CallMethod
): Promise<Record<string, unknown>> {
    const id = config.emailTemplateId;
    if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) {
        return config;
    }
    const fn = callMethod ?? (await getDefaultCallMethod());
    try {
        const res = await fn('notifications.fn_email_template_get', {
            p_organization_id: organizationId,
            p_id: id
        });
        const row = res?.rows?.[0] as EmailTemplateRow | undefined;
        if (!row) {
            logger.warn(
                'email template %d not found for org %s — endpoint will use inline/default templates',
                id,
                organizationId
            );
            return config;
        }
        const libraryAttachments = Array.isArray(row.attachments)
            ? row.attachments
            : [];
        return {
            // Saved defaults first so inline config overrides field-by-field.
            ...(row.subject_template
                ? {subjectTemplate: row.subject_template}
                : {}),
            ...(row.html_template ? {htmlTemplate: row.html_template} : {}),
            ...(row.text_template ? {textTemplate: row.text_template} : {}),
            ...(libraryAttachments.length > 0
                ? {attachments: libraryAttachments}
                : {}),
            ...config
        };
    } catch (err) {
        logger.warn(
            'email template resolve failed for id=%d org=%s: %s',
            id,
            organizationId,
            err instanceof Error ? err.message : String(err)
        );
        return config;
    }
}
