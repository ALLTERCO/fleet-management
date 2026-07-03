import {toIso} from '../../rpc/pgRows';
import {readObject} from '../notification/rowReaders';
import * as PostgresProvider from '../PostgresProvider';

export interface StoredBundleChannel {
    id: number;
    organizationId: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string | null;
}

interface ChannelRow {
    id: number | string;
    organization_id: string;
    provider: string;
    name: string;
    config: unknown;
    created_at: Date | string;
    updated_at: Date | string | null;
}

export async function listBundleChannels(input: {
    organizationId: string;
}): Promise<StoredBundleChannel[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_channel_list',
        {
            p_organization_id: input.organizationId
        }
    );
    return ((result?.rows ?? []) as ChannelRow[]).map(rowToChannel);
}

export async function setBundleChannel(input: {
    organizationId: string;
    channelId: number;
    name: string;
    config: Record<string, unknown>;
}): Promise<StoredBundleChannel> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_channel_update',
        {
            p_organization_id: input.organizationId,
            p_id: input.channelId,
            p_name: input.name,
            p_config: input.config
        }
    );
    const row = result?.rows?.[0] as ChannelRow | undefined;
    if (!row) throw new Error('notification channel update returned no row');
    return rowToChannel(row);
}

function rowToChannel(row: ChannelRow): StoredBundleChannel {
    return {
        id: Number(row.id),
        organizationId: row.organization_id,
        name: row.name,
        type: row.provider,
        config: readObject(row.config),
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}
