// Push-notification token registry + per-user notification inbox.

import * as AlertEvents from '../../../modules/AlertEvents';
import {deriveInboxAvailableActions} from '../../../modules/notificationInboxModel';
import * as PostgresProvider from '../../../modules/PostgresProvider';
import {buildListResponse} from '../../../rpc/listResponse';
import {toIso} from '../../../rpc/pgRows';
import RpcError from '../../../rpc/RpcError';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import type {AlertRuleKind, AlertScopeType} from '../../../types/api/alert';
import {
    type InboxState,
    NOTIFICATION_INBOX_GET_PARAMS_SCHEMA,
    NOTIFICATION_INBOX_LIST_PARAMS_SCHEMA,
    NOTIFICATION_INBOX_MARK_ALL_READ_PARAMS_SCHEMA,
    NOTIFICATION_INBOX_MARK_READ_PARAMS_SCHEMA,
    NOTIFICATION_INBOX_MARK_UNREAD_PARAMS_SCHEMA,
    NOTIFICATION_LIST_TOKENS_PARAMS_SCHEMA,
    NOTIFICATION_SUBSCRIBE_PARAMS_SCHEMA,
    type NotificationInboxItem,
    type NotificationKind
} from '../../../types/api/notification';
import type CommandSender from '../../CommandSender';
import {requireAuthenticatedUser} from './notificationHandlerContext';

interface InboxRow {
    id: number;
    organization_id: string;
    user_id: string;
    kind: NotificationKind;
    state: InboxState;
    alert_id: number | null;
    source_subject_type: AlertScopeType | null;
    source_subject_id: string | null;
    title: string;
    message: string;
    stored_available_actions: unknown;
    created_at: Date | string;
    read_at: Date | string | null;
    alert_state: 'active' | 'acknowledged' | 'resolved' | null;
    alert_rule_kind: AlertRuleKind | null;
    alert_silenced_until: Date | string | null;
}

type InboxListRow = Partial<InboxRow> & {total_count?: number | string};

function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];

        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed) as unknown;
                return toStringArray(parsed);
            } catch {
                return [];
            }
        }

        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            return trimmed
                .slice(1, -1)
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
        }
    }

    return [];
}

function rowToInboxItem(row: InboxRow): NotificationInboxItem {
    const source =
        row.source_subject_type && row.source_subject_id
            ? {
                  organizationId: row.organization_id,
                  subjectType: row.source_subject_type,
                  subjectId: row.source_subject_id
              }
            : null;

    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        kind: row.kind,
        state: row.state,
        alertId: row.alert_id,
        source,
        title: row.title,
        message: row.message,
        createdAt: toIso(row.created_at) ?? '',
        readAt: toIso(row.read_at),
        availableActions: deriveInboxAvailableActions({
            state: row.state,
            source,
            alertState: row.alert_state,
            alertKind: row.alert_rule_kind,
            silencedUntil: toIso(row.alert_silenced_until),
            storedAvailableActions: toStringArray(row.stored_available_actions)
        })
    };
}

/** Broadcast an inbox-state change so every client can reconcile instantly. */
function emitReadStateChanged(
    organizationId: string,
    userId: string,
    notificationId: number,
    state: InboxState
): void {
    AlertEvents.emitNotificationReadStateChanged({
        organizationId,
        userId,
        notificationId,
        state
    });
}

function emitMarkAllRead(
    organizationId: string,
    userId: string,
    updatedCount: number
): void {
    AlertEvents.emitNotificationReadStateChanged({
        organizationId,
        userId,
        updatedCount,
        state: 'read'
    });
}

async function getInboxRow(
    organizationId: string,
    userId: string,
    id: number
): Promise<InboxRow | undefined> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_notification_inbox_get',
        {
            p_organization_id: organizationId,
            p_user_id: userId,
            p_id: id
        }
    );
    return result?.rows?.[0] as InboxRow | undefined;
}

async function requireInboxRow(
    organizationId: string,
    userId: string,
    id: number
): Promise<InboxRow> {
    const row = await getInboxRow(organizationId, userId, id);
    if (!row) throw RpcError.NotFound('notification_inbox_item', id);
    return row;
}

export async function subscribe(rawParams: unknown, sender: CommandSender) {
    const params = validateOrThrow<{token?: string}>(
        rawParams ?? {},
        NOTIFICATION_SUBSCRIBE_PARAMS_SCHEMA
    );
    const token = (params.token ?? '').trim();

    if (!token) {
        throw RpcError.InvalidParams(
            'Notification.Subscribe: "token" must be a non-empty string'
        );
    }

    const userId = requireAuthenticatedUser(sender);

    try {
        const res = await PostgresProvider.callMethod(
            'notifications.add_token',
            {p_token: token, p_user_id: userId}
        );

        const row =
            Array.isArray(res?.rows) && res.rows.length > 0
                ? res.rows[0]
                : {token, user_id: userId};

        return {
            id: row.id ?? null,
            token: row.token ?? token,
            userId: row.user_id ?? userId
        };
    } catch (err: unknown) {
        throw RpcError.OperationFailed('Notification.Subscribe', err);
    }
}

export async function listTokens(params: unknown) {
    const p = validateOrThrow<{limit?: number; offset?: number}>(
        params ?? {},
        NOTIFICATION_LIST_TOKENS_PARAMS_SCHEMA
    );
    try {
        const res = await PostgresProvider.callMethod(
            'notifications.get_all_tokens',
            {}
        );
        const rows = Array.isArray(res?.rows) ? res.rows : [];

        const mapped = rows.map((r: Record<string, unknown>) => ({
            id: r.id ?? null,
            token: r.token ?? null,
            userId: r.user_id ?? null,
            created: r.created ?? null,
            updated: r.updated ?? null
        }));
        // Page in memory — the underlying SQL has no limit/offset and
        // token counts are bounded (single-digit thousands worst case).
        const total = mapped.length;
        const limit = typeof p.limit === 'number' && p.limit > 0 ? p.limit : 0;
        const offset = typeof p.offset === 'number' ? p.offset : 0;
        const sliced =
            limit > 0
                ? mapped.slice(offset, offset + limit)
                : mapped.slice(offset);
        return buildListResponse(sliced, total, limit, offset);
    } catch (err: unknown) {
        throw RpcError.OperationFailed('Notification.ListTokens', err);
    }
}

export async function listInbox(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        state?: InboxState;
        kind?: NotificationKind;
        query?: string;
        limit?: number;
        offset?: number;
    }>(params, NOTIFICATION_INBOX_LIST_PARAMS_SCHEMA);
    const organizationId = requireOrganizationId(sender, p);
    const userId = requireAuthenticatedUser(sender);
    const limit = p.limit ?? 200;
    const offset = p.offset ?? 0;

    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_notification_inbox_list',
            {
                p_organization_id: organizationId,
                p_user_id: userId,
                p_state: p.state ?? null,
                p_kind: p.kind ?? null,
                p_query: p.query?.trim() || null,
                p_limit: limit,
                p_offset: offset
            }
        );
        const rows = (result?.rows ?? []) as InboxListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: NotificationInboxItem[] = [];

        for (const row of rows) {
            if (row.id == null) continue;
            items.push(rowToInboxItem(row as InboxRow));
        }

        return buildListResponse(items, total, limit, offset);
    } catch (err: unknown) {
        throw RpcError.OperationFailed('Notification.Inbox.List', err);
    }
}

export async function getInbox(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_INBOX_GET_PARAMS_SCHEMA
    );
    const organizationId = requireOrganizationId(sender, p);
    const userId = requireAuthenticatedUser(sender);

    try {
        return rowToInboxItem(
            await requireInboxRow(organizationId, userId, p.id)
        );
    } catch (err: unknown) {
        if (err instanceof RpcError) throw err;
        throw RpcError.OperationFailed('Notification.Inbox.Get', err);
    }
}

export async function markInboxRead(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_INBOX_MARK_READ_PARAMS_SCHEMA
    );
    const organizationId = requireOrganizationId(sender, p);
    const userId = requireAuthenticatedUser(sender);

    try {
        const current = await requireInboxRow(organizationId, userId, p.id);
        if (current.state === 'read') {
            return rowToInboxItem(current);
        }

        const result = await PostgresProvider.callMethod(
            'notifications.fn_notification_inbox_mark_read',
            {
                p_organization_id: organizationId,
                p_user_id: userId,
                p_id: p.id
            }
        );
        const row = result?.rows?.[0] as InboxRow | undefined;
        const target = row ?? current;
        emitReadStateChanged(organizationId, userId, target.id, 'read');
        return rowToInboxItem(target);
    } catch (err: unknown) {
        if (err instanceof RpcError) throw err;
        throw RpcError.OperationFailed('Notification.Inbox.MarkRead', err);
    }
}

export async function markInboxUnread(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_INBOX_MARK_UNREAD_PARAMS_SCHEMA
    );
    const organizationId = requireOrganizationId(sender, p);
    const userId = requireAuthenticatedUser(sender);

    try {
        const current = await requireInboxRow(organizationId, userId, p.id);
        if (current.state === 'unread') {
            return rowToInboxItem(current);
        }

        const result = await PostgresProvider.callMethod(
            'notifications.fn_notification_inbox_mark_unread',
            {
                p_organization_id: organizationId,
                p_user_id: userId,
                p_id: p.id
            }
        );
        const row = result?.rows?.[0] as InboxRow | undefined;
        const target = row ?? current;
        emitReadStateChanged(organizationId, userId, target.id, 'unread');
        return rowToInboxItem(target);
    } catch (err: unknown) {
        if (err instanceof RpcError) throw err;
        throw RpcError.OperationFailed('Notification.Inbox.MarkUnread', err);
    }
}

export async function markAllInboxRead(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{organizationId?: string}>(
        params,
        NOTIFICATION_INBOX_MARK_ALL_READ_PARAMS_SCHEMA
    );
    const organizationId = requireOrganizationId(sender, p);
    const userId = requireAuthenticatedUser(sender);

    try {
        const result = await PostgresProvider.callMethod(
            'notifications.fn_notification_inbox_mark_all_read',
            {
                p_organization_id: organizationId,
                p_user_id: userId
            }
        );
        const row = result?.rows?.[0] as
            | {updated_count?: number | string}
            | undefined;
        const updatedCount = Number(row?.updated_count ?? 0);
        if (updatedCount > 0) {
            emitMarkAllRead(organizationId, userId, updatedCount);
        }
        return {updatedCount};
    } catch (err: unknown) {
        throw RpcError.OperationFailed('Notification.Inbox.MarkAllRead', err);
    }
}
