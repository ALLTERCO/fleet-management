import {toIso} from '../../rpc/pgRows';
import * as PostgresProvider from '../PostgresProvider';
import {readObject, readStringArray} from './rowReaders';

export interface UserNotificationPreference {
    userId: string;
    channelType: string;
    severityFilters: string[];
    quietHours: Record<string, unknown>;
    digestPreference: Record<string, unknown>;
    disabled: boolean;
    createdAt: string;
    updatedAt: string | null;
}

interface PreferenceRow {
    user_id: string;
    channel_type: string;
    severity_filters: unknown;
    quiet_hours: unknown;
    digest_preference: unknown;
    disabled: boolean;
    created_at: Date | string;
    updated_at: Date | string | null;
}

export async function listUserNotificationPreferences(input: {
    organizationId: string;
    userId: string;
}): Promise<UserNotificationPreference[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_user_notification_preference_list',
        {
            p_organization_id: input.organizationId,
            p_user_id: input.userId
        }
    );
    return ((result?.rows ?? []) as PreferenceRow[]).map(rowToPreference);
}

export async function setUserNotificationPreference(input: {
    organizationId: string;
    userId: string;
    channelType: string;
    severityFilters: string[];
    quietHours: Record<string, unknown>;
    digestPreference: Record<string, unknown>;
    disabled: boolean;
}): Promise<UserNotificationPreference> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_user_notification_preference_upsert',
        {
            p_organization_id: input.organizationId,
            p_user_id: input.userId,
            p_channel_type: input.channelType,
            p_severity_filters: input.severityFilters,
            p_quiet_hours: input.quietHours,
            p_digest_preference: input.digestPreference,
            p_disabled: input.disabled
        }
    );
    const row = result?.rows?.[0] as PreferenceRow | undefined;
    if (!row) throw new Error('preference upsert returned no row');
    return rowToPreference(row);
}

function rowToPreference(row: PreferenceRow): UserNotificationPreference {
    return {
        userId: row.user_id,
        channelType: row.channel_type,
        severityFilters: readStringArray(row.severity_filters),
        quietHours: readObject(row.quiet_hours),
        digestPreference: readObject(row.digest_preference),
        disabled: row.disabled,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}
