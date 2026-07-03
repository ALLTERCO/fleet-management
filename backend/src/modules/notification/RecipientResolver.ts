import {tuning} from '../../config/tuning';
import {BoundedMap} from '../boundedMap';
import * as PostgresProvider from '../PostgresProvider';
import {SingleFlight} from '../singleFlight';
import {
    filterUsersByNotificationPreference,
    type ResolvedPreferenceUsers,
    resolveUsersByNotificationPreference
} from './UserNotificationPreferenceFilter';

const recipientsByRule = new BoundedMap<string, string[]>({
    maxSize: tuning.alert.recipientsCacheMax,
    ttlMs: tuning.alert.recipientsCacheTtlMs
});

const inflight = new SingleFlight<string, string[]>('alert_recipients');

export async function resolveRuleRecipientUsers(input: {
    organizationId: string;
    ruleId: number;
}): Promise<string[]> {
    const key = cacheKey(input);
    const cached = recipientsByRule.get(key);
    if (cached) return cached;
    return inflight.run(key, async () => {
        const users = await loadRuleRecipientUsers(input);
        recipientsByRule.set(key, users);
        return users;
    });
}

export async function resolveInboxRecipientUsers(input: {
    organizationId: string;
    ruleId: number;
    severity: string;
}): Promise<string[]> {
    const users = await resolveRuleRecipientUsers(input);
    return filterUsersByNotificationPreference({
        organizationId: input.organizationId,
        userIds: users,
        channelType: 'in_app',
        severity: input.severity
    });
}

export async function resolveInboxRecipientUsersByMode(input: {
    organizationId: string;
    ruleId: number;
    severity: string;
}): Promise<ResolvedPreferenceUsers> {
    const users = await resolveRuleRecipientUsers(input);
    return resolveUsersByNotificationPreference({
        organizationId: input.organizationId,
        userIds: users,
        channelType: 'in_app',
        severity: input.severity
    });
}

export function invalidateRuleRecipientUsers(input: {
    organizationId: string;
    ruleId: number;
}): void {
    recipientsByRule.delete(cacheKey(input));
}

export function invalidateOrganizationRecipientUsers(
    organizationId: string
): void {
    for (const key of [...recipientsByRule.keys()]) {
        if (key.startsWith(`${organizationId}:`)) recipientsByRule.delete(key);
    }
}

function cacheKey(input: {organizationId: string; ruleId: number}): string {
    return `${input.organizationId}:${input.ruleId}`;
}

async function loadRuleRecipientUsers(input: {
    organizationId: string;
    ruleId: number;
}): Promise<string[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_alert_rule_recipient_users',
        {
            p_organization_id: input.organizationId,
            p_rule_id: input.ruleId
        }
    );
    const rows = (result?.rows ?? []) as Array<{user_id?: string}>;
    return rows.flatMap((row) => (row.user_id ? [row.user_id] : []));
}
