import {toIso} from '../../rpc/pgRows';
import * as PostgresProvider from '../PostgresProvider';
import type {OnCallSchedule} from './OnCallScheduleResolver';
import {readArray, readObject} from './rowReaders';

export interface StoredOnCallSchedule extends OnCallSchedule {
    id: number;
    organizationId: string;
    name: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string | null;
}

interface OnCallScheduleRow {
    id: number | string;
    organization_id: string;
    name: string;
    timezone: string;
    rotation_rules: unknown;
    overrides: unknown;
    target: unknown;
    enabled: boolean;
    created_at: Date | string;
    updated_at: Date | string | null;
}

export async function listOnCallSchedules(input: {
    organizationId: string;
    enabledOnly: boolean;
}): Promise<StoredOnCallSchedule[]> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_on_call_schedule_list',
        {
            p_organization_id: input.organizationId,
            p_enabled_only: input.enabledOnly
        }
    );
    return ((result?.rows ?? []) as OnCallScheduleRow[]).map(rowToSchedule);
}

export async function getOnCallSchedule(input: {
    organizationId: string;
    scheduleId: number;
}): Promise<StoredOnCallSchedule | null> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_on_call_schedule_get',
        {
            p_organization_id: input.organizationId,
            p_schedule_id: input.scheduleId
        }
    );
    const row = result?.rows?.[0] as OnCallScheduleRow | undefined;
    return row ? rowToSchedule(row) : null;
}

export async function setOnCallSchedule(input: {
    organizationId: string;
    scheduleId?: number;
    name: string;
    timezone: string;
    rotationRules: unknown[];
    overrides: unknown[];
    target: Record<string, unknown>;
    enabled: boolean;
}): Promise<StoredOnCallSchedule> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_on_call_schedule_upsert',
        {
            p_organization_id: input.organizationId,
            p_schedule_id: input.scheduleId ?? null,
            p_name: input.name,
            p_timezone: input.timezone,
            p_rotation_rules: input.rotationRules,
            p_overrides: input.overrides,
            p_target: input.target,
            p_enabled: input.enabled
        }
    );
    const row = result?.rows?.[0] as OnCallScheduleRow | undefined;
    if (!row) throw new Error('on-call schedule upsert returned no row');
    return rowToSchedule(row);
}

export async function deleteOnCallSchedule(input: {
    organizationId: string;
    scheduleId: number;
}): Promise<boolean> {
    const result = await PostgresProvider.callMethod(
        'notifications.fn_on_call_schedule_delete',
        {
            p_organization_id: input.organizationId,
            p_schedule_id: input.scheduleId
        }
    );
    return result?.rows?.[0]?.fn_on_call_schedule_delete === true;
}

function rowToSchedule(row: OnCallScheduleRow): StoredOnCallSchedule {
    return {
        id: Number(row.id),
        organizationId: row.organization_id,
        name: row.name,
        timezone: row.timezone,
        rotationRules: readArray(row.rotation_rules),
        overrides: readArray(row.overrides),
        target: readObject(row.target),
        enabled: row.enabled,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}
