// Mobile composite endpoint helpers. Direct domain calls, no Commander.

import type CommandSender from '../../model/CommandSender';
import * as Commander from '../Commander';
import * as postgres from '../PostgresProvider';
import {listUnifiedWaitingRoom} from '../WaitingRoom/unified';

interface AlertInstanceCountRow {
    total_count?: number | string;
}

const EMPTY_DEVICES = {items: [] as unknown[], total: 0};
const EMPTY_WAITING_ROOM = {count: 0, pending: {}};
const EMPTY_ALERTS = {open: 0, critical: 0};

interface WaitingRoomReader {
    listUnifiedWaitingRoom: typeof listUnifiedWaitingRoom;
}

const DEFAULT_WAITING_ROOM_READER: WaitingRoomReader = {
    listUnifiedWaitingRoom
};

export function canSeeDevices(sender: CommandSender): boolean {
    return sender.hasCrudPermission('devices', 'read');
}

export function canSeeWaitingRoom(sender: CommandSender): boolean {
    return sender.hasCrudPermission('waiting_room', 'read');
}

export function canSeeAlerts(sender: CommandSender): boolean {
    return sender.hasCrudPermission('alerts', 'read');
}

export async function readSlimDevices(
    sender: CommandSender,
    limit: number,
    filters?: Record<string, unknown>
): Promise<{items: unknown[]; total: number}> {
    if (!canSeeDevices(sender)) return EMPTY_DEVICES;
    try {
        const res = await Commander.exec(sender, 'device.list', {
            limit,
            offset: 0,
            ...(filters ? {filters} : {})
        });
        const items = Array.isArray(res?.items) ? res.items : [];
        const total = Number.isFinite(res?.total) ? res.total : items.length;
        return {items, total};
    } catch {
        return EMPTY_DEVICES;
    }
}

export async function readWaitingRoomState(
    sender: CommandSender,
    reader: WaitingRoomReader = DEFAULT_WAITING_ROOM_READER
): Promise<{count: number; pending: Record<string, unknown>}> {
    if (!canSeeWaitingRoom(sender)) return EMPTY_WAITING_ROOM;
    const organizationId = sender.getOrganizationId();
    if (!organizationId) return EMPTY_WAITING_ROOM;
    try {
        const list = await reader.listUnifiedWaitingRoom({
            organizationId,
            state: 'open'
        });
        return {
            count: list.total,
            pending: Object.fromEntries(
                list.items.map((item) => [item.entryId, item])
            )
        };
    } catch {
        return EMPTY_WAITING_ROOM;
    }
}

export async function readAlertCounts(
    sender: CommandSender
): Promise<{open: number; critical: number}> {
    if (!canSeeAlerts(sender)) return EMPTY_ALERTS;
    const orgId = sender.getOrganizationId();
    if (!orgId) return EMPTY_ALERTS;
    try {
        const [openRes, critRes] = await Promise.all([
            queryAlertCount(orgId, null),
            queryAlertCount(orgId, 'critical')
        ]);
        return {open: openRes, critical: critRes};
    } catch {
        return EMPTY_ALERTS;
    }
}

async function queryAlertCount(
    orgId: string,
    severity: string | null
): Promise<number> {
    const res = await postgres.callMethod(
        'notifications.fn_alert_instance_list',
        {
            p_organization_id: orgId,
            p_state: 'open',
            p_severity: severity,
            p_rule_id: null,
            p_source_type: null,
            p_source_id: null,
            p_location_ids: null,
            p_group_ids: null,
            p_tag_ids: null,
            p_query: null,
            p_limit: 1,
            p_offset: 0
        }
    );
    const row = res?.rows?.[0] as AlertInstanceCountRow | undefined;
    return Number(row?.total_count ?? 0);
}

export async function readUserPermissions(
    sender: CommandSender
): Promise<Record<string, unknown>> {
    try {
        const res = await Commander.exec(sender, 'user.getme', {});
        return (res ?? {}) as Record<string, unknown>;
    } catch {
        return {};
    }
}
