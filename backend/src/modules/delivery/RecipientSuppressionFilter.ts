import {readStringArray} from '../notification/rowReaders';
import * as PostgresProvider from '../PostgresProvider';
import type {DeliveryContext} from './types';

type EmailRecipientField = 'toAddresses' | 'ccAddresses' | 'bccAddresses';

export interface SuppressionFilterResult {
    context: DeliveryContext;
    suppressedRecipients: string[];
    /** True when the endpoint had recipients but every one is suppressed —
     *  the caller should no-op rather than send to an empty list. */
    allRecipientsSuppressed: boolean;
}

export async function applyEmailRecipientSuppressions(
    context: DeliveryContext
): Promise<SuppressionFilterResult> {
    const recipients = collectEmailRecipients(context.config);
    if (recipients.length === 0) return passThrough(context);
    const suppressions = await loadActiveSuppressions({
        organizationId: context.organizationId,
        channelType: 'email_smtp',
        recipients
    });
    if (suppressions.size === 0) return passThrough(context);
    const filteredConfig = filterEmailRecipientConfig(
        context.config,
        suppressions
    );
    return {
        context: {...context, config: filteredConfig},
        suppressedRecipients: [...suppressions],
        allRecipientsSuppressed:
            collectEmailRecipients(filteredConfig).length === 0
    };
}

// Nothing suppressed: deliver the context unchanged.
function passThrough(context: DeliveryContext): SuppressionFilterResult {
    return {context, suppressedRecipients: [], allRecipientsSuppressed: false};
}

function collectEmailRecipients(config: Record<string, unknown>): string[] {
    return [
        ...readStringArray(config.toAddresses),
        ...readStringArray(config.ccAddresses),
        ...readStringArray(config.bccAddresses)
    ];
}

async function loadActiveSuppressions(input: {
    organizationId: string;
    channelType: string;
    recipients: string[];
}): Promise<Set<string>> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_notification_suppression_active_list',
        {
            p_organization_id: input.organizationId,
            p_channel_type: input.channelType,
            p_recipients: input.recipients
        }
    );
    const rows = (result?.rows ?? []) as Array<{recipient?: string}>;
    return new Set(
        rows
            .map((row) => row.recipient)
            .filter((value): value is string => typeof value === 'string')
            .map(normalizeRecipient)
    );
}

function filterEmailRecipientConfig(
    config: Record<string, unknown>,
    suppressed: Set<string>
): Record<string, unknown> {
    return {
        ...config,
        toAddresses: filterRecipientField(config, suppressed, 'toAddresses'),
        ccAddresses: filterRecipientField(config, suppressed, 'ccAddresses'),
        bccAddresses: filterRecipientField(config, suppressed, 'bccAddresses')
    };
}

function filterRecipientField(
    config: Record<string, unknown>,
    suppressed: Set<string>,
    field: EmailRecipientField
): string[] {
    return readStringArray(config[field]).filter(
        (recipient) => !suppressed.has(normalizeRecipient(recipient))
    );
}

function normalizeRecipient(recipient: string): string {
    return recipient.trim().toLowerCase();
}
