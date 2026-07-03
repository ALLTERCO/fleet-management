import * as PostgresProvider from '../PostgresProvider';

export interface PreferenceFilterInput {
    organizationId: string;
    userIds: string[];
    channelType: string;
    severity: string;
}

export interface ResolvedPreferenceUsers {
    immediateUserIds: string[];
    digestUserIds: string[];
}

export async function filterUsersByNotificationPreference(
    input: PreferenceFilterInput
): Promise<string[]> {
    const resolved = await resolveUsersByNotificationPreference(input);
    return resolved.immediateUserIds;
}

export async function resolveUsersByNotificationPreference(
    input: PreferenceFilterInput
): Promise<ResolvedPreferenceUsers> {
    if (input.userIds.length === 0) {
        return {immediateUserIds: [], digestUserIds: []};
    }
    const result = await PostgresProvider.callMethod(
        'notifications.fn_user_notification_preference_resolve',
        {
            p_organization_id: input.organizationId,
            p_user_ids: input.userIds,
            p_channel_type: input.channelType,
            p_severity: input.severity
        }
    );
    const rows = (result?.rows ?? []) as Array<{
        user_id?: string;
        delivery_mode?: string;
    }>;
    return splitUsersByDeliveryMode(rows);
}

function splitUsersByDeliveryMode(
    rows: Array<{user_id?: string; delivery_mode?: string}>
): ResolvedPreferenceUsers {
    const immediateUserIds: string[] = [];
    const digestUserIds: string[] = [];
    for (const row of rows) {
        if (!row.user_id) continue;
        if (row.delivery_mode === 'digest') digestUserIds.push(row.user_id);
        else immediateUserIds.push(row.user_id);
    }
    return {immediateUserIds, digestUserIds};
}
