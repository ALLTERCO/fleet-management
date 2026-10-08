// Dashboard activity log. The store owns row-shape translation; callers
// see camelCase TS types only. Writes are fire-and-forget — `appendActivity`
// is pure DO (no return value), reads are pure ANSWER (`listActivity`).
// Separation of command and query (CQS).

import {toIso} from '../rpc/pgRows';
import type {AssignmentScope} from '../types/api/assignment';
import * as PostgresProvider from './PostgresProvider';

export type DashboardActivityKind =
    | 'created'
    | 'updated'
    | 'shared'
    | 'unshared'
    | 'cloned'
    | 'pinned'
    | 'unpinned'
    | 'owner_changed'
    | 'item_added'
    | 'item_removed';

export interface DashboardActivityEntry {
    id: number;
    dashboardId: number;
    organizationId: string;
    actorUserId: string | null;
    eventKind: DashboardActivityKind;
    detail: Record<string, unknown>;
    occurredAt: string;
}

interface ActivityRow {
    id: number | string;
    dashboard_id: number | string;
    organization_id: string;
    actor_user_id: string | null;
    event_kind: string;
    detail: unknown;
    occurred_at: Date | string;
}

interface AppendInput {
    dashboardId: number;
    organizationId: string;
    actorUserId: string | null;
    eventKind: DashboardActivityKind;
    detail?: Record<string, unknown>;
}

export interface AppendDashboardSharingActivityInput {
    organizationId: string;
    actorUserId: string | null;
    eventKind: 'shared' | 'unshared';
    assignmentId: string;
    subjectType: string;
    subjectId: string;
    personaId: string;
    scope: AssignmentScope;
}

// DO — write one row, return nothing. Callers that need to confirm the
// write should listActivity afterwards or rely on database errors
// (constraint violation, missing FK) to surface failures as thrown errors.
export async function appendActivity(input: AppendInput): Promise<void> {
    await PostgresProvider.callMethod('ui.fn_dashboard_activity_append', {
        p_dashboard_id: input.dashboardId,
        p_organization_id: input.organizationId,
        p_actor_user_id: input.actorUserId,
        p_event_kind: input.eventKind,
        p_detail: input.detail ?? {}
    });
}

/**
 * Record the dashboard-facing lifecycle of one assignment. The assignment
 * scope is the single source of dashboard ids, so callers do not need a
 * second resource lookup or their own scope parsing.
 */
export async function appendDashboardSharingActivity(
    input: AppendDashboardSharingActivityInput
): Promise<void> {
    const dashboardIds = [
        ...new Set(
            (input.scope.dashboard_ids ?? []).filter(
                (id): id is number => Number.isInteger(id) && id > 0
            )
        )
    ];
    await Promise.all(
        dashboardIds.map((dashboardId) =>
            appendActivity({
                dashboardId,
                organizationId: input.organizationId,
                actorUserId: input.actorUserId,
                eventKind: input.eventKind,
                detail: {
                    assignmentId: input.assignmentId,
                    subjectType: input.subjectType,
                    subjectId: input.subjectId,
                    personaId: input.personaId
                }
            })
        )
    );
}

interface ListInput {
    dashboardId: number;
    limit?: number;
}

// ANSWER — read recent rows in occurred_at DESC order. No state change.
export async function listActivity(
    input: ListInput
): Promise<DashboardActivityEntry[]> {
    const result = await PostgresProvider.callMethod(
        'ui.fn_dashboard_activity_list',
        {
            p_dashboard_id: input.dashboardId,
            p_limit: input.limit ?? 20
        }
    );
    return ((result?.rows ?? []) as ActivityRow[]).map(rowToEntry);
}

function rowToEntry(row: ActivityRow): DashboardActivityEntry {
    return {
        id: Number(row.id),
        dashboardId: Number(row.dashboard_id),
        organizationId: row.organization_id,
        actorUserId: row.actor_user_id,
        eventKind: row.event_kind as DashboardActivityKind,
        detail: readObject(row.detail),
        occurredAt: toIso(row.occurred_at) ?? ''
    };
}

function readObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}
