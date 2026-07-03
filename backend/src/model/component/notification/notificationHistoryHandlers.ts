// Delivery-job history listing, detail, and manual requeue.

import * as AlertEvents from '../../../modules/AlertEvents';
import * as OutboxWorker from '../../../modules/delivery/OutboxWorker';
import type {DeliveryPayload} from '../../../modules/delivery/types';
import * as NotificationAuditWriter from '../../../modules/notification/NotificationAuditWriter';
import * as PostgresProvider from '../../../modules/PostgresProvider';
import {buildListResponse} from '../../../rpc/listResponse';
import {toIso} from '../../../rpc/pgRows';
import RpcError from '../../../rpc/RpcError';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import type {ChannelProvider} from '../../../types/api/channel';
import {
    type DeliveryAttempt,
    type DeliveryAttemptState,
    type DeliveryJob,
    type DeliveryJobState,
    NOTIFICATION_HISTORY_GET_PARAMS_SCHEMA,
    NOTIFICATION_HISTORY_LIST_PARAMS_SCHEMA,
    NOTIFICATION_HISTORY_REQUEUE_PARAMS_SCHEMA
} from '../../../types/api/notification';
import type CommandSender from '../../CommandSender';
import {auditActor} from './notificationHandlerContext';

interface DeliveryJobRow {
    id: number;
    organization_id: string;
    alert_id: number | null;
    inbox_item_id: number | null;
    endpoint_id: number;
    state: DeliveryJobState;
    created_at: Date | string;
    completed_at: Date | string | null;
    attempt_count: number;
}
type DeliveryJobListRow = Partial<DeliveryJobRow> & {
    total_count?: number | string;
};

interface DeliveryAttemptRow {
    id: number;
    job_id: number;
    endpoint_id: number;
    state: DeliveryAttemptState;
    attempted_at: Date | string;
    http_status: number | null;
    provider_code: string | null;
    error_message: string | null;
}

function rowToDeliveryJob(row: DeliveryJobRow): DeliveryJob {
    return {
        id: row.id,
        organizationId: row.organization_id,
        alertId: row.alert_id,
        inboxItemId: row.inbox_item_id,
        channelId: row.endpoint_id,
        state: row.state,
        createdAt: toIso(row.created_at) ?? '',
        completedAt: toIso(row.completed_at),
        attemptCount: Number(row.attempt_count ?? 0)
    };
}

type RequeuedJobRow = DeliveryJobRow & {
    alert_title: string;
    alert_message: string;
    alert_severity: DeliveryPayload['severity'];
    alert_state: DeliveryPayload['state'];
    alert_rule_kind: string;
    alert_active_since: Date | string;
    alert_fired_at: Date | string;
    source_subject_type: NonNullable<DeliveryPayload['source']>['subjectType'];
    source_subject_id: string;
    rule_id: number;
    rule_name: string;
};

function rowToDeliveryPayload(row: RequeuedJobRow): DeliveryPayload {
    return {
        title: row.alert_title,
        message: row.alert_message,
        severity: row.alert_severity,
        organizationId: row.organization_id,
        alertId: row.alert_id,
        ruleId: row.rule_id,
        ruleName: row.rule_name,
        ruleKind: row.alert_rule_kind,
        state: row.alert_state,
        firedAt: toIso(row.alert_fired_at) ?? '',
        activeSince: toIso(row.alert_active_since) ?? '',
        source: {
            subjectType: row.source_subject_type,
            subjectId: row.source_subject_id
        }
    };
}

function rowToDeliveryAttempt(row: DeliveryAttemptRow): DeliveryAttempt {
    return {
        id: row.id,
        jobId: row.job_id,
        channelId: row.endpoint_id,
        state: row.state,
        attemptedAt: toIso(row.attempted_at) ?? '',
        httpStatus: row.http_status,
        providerCode: row.provider_code,
        errorMessage: row.error_message
    };
}

export async function historyList(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        endpointId?: number;
        state?: DeliveryJobState;
        provider?: ChannelProvider;
        alertId?: number;
        from?: string;
        to?: string;
        limit?: number;
        offset?: number;
    }>(params, NOTIFICATION_HISTORY_LIST_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const limit = p.limit ?? 200;
    const offset = p.offset ?? 0;

    const result = await PostgresProvider.callMethod(
        'notifications.fn_delivery_job_list',
        {
            p_organization_id: orgId,
            p_endpoint_id: p.endpointId ?? null,
            p_state: p.state ?? null,
            p_provider: p.provider ?? null,
            p_alert_id: p.alertId ?? null,
            p_from: p.from ?? null,
            p_to: p.to ?? null,
            p_limit: limit,
            p_offset: offset
        }
    );
    const rows = (result?.rows ?? []) as DeliveryJobListRow[];
    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    const items: DeliveryJob[] = [];
    for (const row of rows) {
        if (row.id == null) continue;
        items.push(rowToDeliveryJob(row as DeliveryJobRow));
    }
    return buildListResponse(items, total, limit, offset);
}

export async function historyGet(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_HISTORY_GET_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);

    const [jobRes, attemptsRes] = await Promise.all([
        PostgresProvider.callMethod('notifications.fn_delivery_job_get', {
            p_organization_id: orgId,
            p_id: p.id
        }),
        PostgresProvider.callMethod(
            'notifications.fn_delivery_job_list_attempts',
            {p_organization_id: orgId, p_job_id: p.id}
        )
    ]);

    const jobRow = jobRes?.rows?.[0] as DeliveryJobRow | undefined;
    if (!jobRow)
        throw RpcError.Domain('DeliveryJobNotFound', {
            details: {id: p.id}
        });

    const attemptRows = (attemptsRes?.rows ?? []) as DeliveryAttemptRow[];
    return {
        job: rowToDeliveryJob(jobRow),
        attempts: attemptRows.map(rowToDeliveryAttempt)
    };
}

export async function historyRequeue(
    params: unknown,
    sender: CommandSender
): Promise<DeliveryJob> {
    const p = validateOrThrow<{organizationId?: string; id: number}>(
        params,
        NOTIFICATION_HISTORY_REQUEUE_PARAMS_SCHEMA
    );
    const orgId = requireOrganizationId(sender, p);

    try {
        const res = await PostgresProvider.callMethod(
            'notifications.fn_delivery_job_requeue',
            {p_organization_id: orgId, p_id: p.id}
        );
        const row = res?.rows?.[0] as RequeuedJobRow | undefined;
        if (!row)
            throw RpcError.Domain('DeliveryJobNotFound', {
                details: {id: p.id}
            });

        await OutboxWorker.enqueueSend({
            deliveryJobId: row.id,
            message: rowToDeliveryPayload(row)
        });
        AlertEvents.emitNotificationDeliveryUpdated({
            organizationId: row.organization_id,
            jobId: row.id,
            endpointId: row.endpoint_id,
            state: row.state
        });
        await NotificationAuditWriter.writeManualRetry({
            organizationId: row.organization_id,
            actorId: auditActor(sender),
            jobId: row.id,
            endpointId: row.endpoint_id
        });
        return rowToDeliveryJob(row);
    } catch (err: unknown) {
        if (err instanceof RpcError) throw err;
        throw RpcError.OperationFailed('Notification.History.Requeue', err);
    }
}
