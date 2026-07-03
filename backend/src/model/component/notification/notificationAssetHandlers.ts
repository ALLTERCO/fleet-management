// Email assets plus OAuth consent start.

import * as EmailAssets from '../../../modules/delivery/emailAssets';
import {startConsent} from '../../../modules/delivery/oauthConsent';
import * as PostgresProvider from '../../../modules/PostgresProvider';
import {
    issueUploadTicket,
    uploadTicketResponse,
    uploadTicketUserFromSender
} from '../../../modules/uploadTickets';
import {buildListResponse} from '../../../rpc/listResponse';
import RpcError from '../../../rpc/RpcError';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import {
    type EmailAsset,
    NOTIFICATION_EMAIL_ASSET_DELETE_PARAMS_SCHEMA,
    NOTIFICATION_EMAIL_ASSET_GET_PARAMS_SCHEMA,
    NOTIFICATION_EMAIL_ASSET_LIST_PARAMS_SCHEMA,
    NOTIFICATION_OAUTH_START_PARAMS_SCHEMA
} from '../../../types/api/notification';
import {EMPTY_PARAMS_SCHEMA} from '../../../types/api/upload';
import type CommandSender from '../../CommandSender';

export async function emailAssetList(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        limit?: number;
        offset?: number;
    }>(params, NOTIFICATION_EMAIL_ASSET_LIST_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const limit = p.limit ?? 200;
    const offset = p.offset ?? 0;
    const {items, total} = await EmailAssets.listAssets(orgId, limit, offset);
    return buildListResponse(
        items.map((a) => ({...a, organizationId: orgId})),
        total,
        limit,
        offset
    );
}

export async function emailAssetCreateUploadTicket(
    params: unknown,
    sender: CommandSender
) {
    validateOrThrow<Record<string, never>>(params ?? {}, EMPTY_PARAMS_SCHEMA);
    requireOrganizationId(sender, {});
    return uploadTicketResponse(
        await issueUploadTicket({
            kind: 'email_asset',
            user: uploadTicketUserFromSender(sender)
        })
    );
}

export async function emailAssetGet(
    params: unknown,
    sender: CommandSender
): Promise<EmailAsset> {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_EMAIL_ASSET_GET_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);
    const md = await EmailAssets.getAssetMetadata(orgId, p.id);
    if (!md) throw RpcError.NotFound('email_asset', p.id);
    return {...md, organizationId: orgId};
}

export async function emailAssetDelete(
    params: unknown,
    sender: CommandSender
): Promise<{deleted: boolean}> {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_EMAIL_ASSET_DELETE_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);
    const deleted = await EmailAssets.deleteAsset(orgId, p.id);
    return {deleted};
}

export async function oauthStart(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        channelId: number;
        provider: 'oauth2_google' | 'oauth2_microsoft';
        tenant?: string;
    }>(params, NOTIFICATION_OAUTH_START_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    // Read channel config to harvest auth.clientId; clientId is public config.
    const row = await PostgresProvider.callMethod(
        'notifications.fn_channel_get',
        {p_organization_id: orgId, p_id: p.channelId}
    );
    const channel = row?.rows?.[0] as
        | {provider?: string; config?: Record<string, unknown>}
        | undefined;
    if (!channel) {
        throw RpcError.NotFound('channel', p.channelId);
    }
    if (channel.provider !== 'email_smtp') {
        throw RpcError.InvalidParams('OAuth.Start: channel must be email_smtp');
    }
    const auth = channel.config?.auth as Record<string, unknown> | undefined;
    const clientId = typeof auth?.clientId === 'string' ? auth.clientId : '';
    if (!clientId) {
        throw RpcError.InvalidParams(
            'OAuth.Start: channel config is missing auth.clientId — save it first'
        );
    }
    return startConsent({
        organizationId: orgId,
        endpointId: p.channelId,
        provider: p.provider,
        clientId,
        tenant: p.tenant
    });
}
