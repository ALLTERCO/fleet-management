import * as AuditLogger from '../AuditLogger';

type NotificationAuditEventType =
    | 'notification_config_change'
    | 'notification_test_send'
    | 'notification_manual_retry'
    | 'notification_endpoint_reenable';

interface NotificationAuditDependencies {
    log: typeof AuditLogger.log;
}

const defaultDependencies: NotificationAuditDependencies = {
    log: AuditLogger.log
};

interface BaseNotificationAuditInput {
    organizationId: string;
    actorId?: string | null;
    success?: boolean;
    errorMessage?: string | null;
}

export function writeEndpointConfigChange(
    input: BaseNotificationAuditInput & {
        action: 'create' | 'update' | 'delete';
        endpointId: number;
        provider?: string | null;
    },
    dependencies: NotificationAuditDependencies = defaultDependencies
): Promise<number | null> {
    return writeNotificationAudit(
        'notification_config_change',
        'Channel.ConfigChange',
        {
            action: input.action,
            endpointId: input.endpointId,
            provider: input.provider ?? null
        },
        input,
        dependencies
    );
}

export function writeChannelTestSend(
    input: BaseNotificationAuditInput & {
        channelId: number;
        provider: string;
        dryRun: boolean;
        state: 'success' | 'failed';
    },
    dependencies: NotificationAuditDependencies = defaultDependencies
): Promise<number | null> {
    return writeNotificationAudit(
        'notification_test_send',
        'Channel.Test',
        {
            channelId: input.channelId,
            provider: input.provider,
            dryRun: input.dryRun,
            state: input.state
        },
        input,
        dependencies
    );
}

export function writeEndpointReenable(
    input: BaseNotificationAuditInput & {
        endpointId: number;
        reEnable: boolean;
    },
    dependencies: NotificationAuditDependencies = defaultDependencies
): Promise<number | null> {
    return writeNotificationAudit(
        'notification_endpoint_reenable',
        'Channel.ResetHealth',
        {
            endpointId: input.endpointId,
            reEnable: input.reEnable
        },
        input,
        dependencies
    );
}

export function writeManualRetry(
    input: BaseNotificationAuditInput & {
        jobId: number;
        endpointId: number;
    },
    dependencies: NotificationAuditDependencies = defaultDependencies
): Promise<number | null> {
    return writeNotificationAudit(
        'notification_manual_retry',
        'Notification.History.Requeue',
        {
            jobId: input.jobId,
            endpointId: input.endpointId
        },
        input,
        dependencies
    );
}

function writeNotificationAudit(
    eventType: NotificationAuditEventType,
    method: string,
    params: Record<string, unknown>,
    input: BaseNotificationAuditInput,
    dependencies: NotificationAuditDependencies
): Promise<number | null> {
    return dependencies.log({
        eventType,
        username: input.actorId ?? undefined,
        method,
        params,
        success: input.success ?? true,
        errorMessage: input.errorMessage ?? undefined,
        organizationId: input.organizationId
    });
}
