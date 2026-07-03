// Alert + Notification WS emitters. params.organizationId is the
// tenant; eventData.organizationId tags the fanout so only same-tenant
// listeners receive it (provider support + trusted senders cross).

import type {AlertRuleKind, AlertSeverity} from '../types/api/alert';
import * as EventDistributor from './EventDistributor';

export interface AlertWsParams {
    organizationId: string;
    alertId: number;
    ruleId: number;
    ruleKind: AlertRuleKind;
    state: string;
    severity: AlertSeverity;
}

export function emitAlertCreated(params: AlertWsParams): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Alert.Created', params},
        {organizationId: params.organizationId}
    );
}

export function emitAlertUpdated(params: AlertWsParams): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Alert.Updated', params},
        {organizationId: params.organizationId}
    );
}

export function emitAlertResolved(params: AlertWsParams): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Alert.Resolved', params},
        {organizationId: params.organizationId}
    );
}

export interface InboxCreatedParams {
    organizationId: string;
    userId: string;
    notificationId: number;
    alertId?: number;
    kind: 'alert_created' | 'alert_updated' | 'alert_resolved' | 'alert_digest';
}

export function emitNotificationCreated(params: InboxCreatedParams): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Notification.Created', params},
        {organizationId: params.organizationId}
    );
}

export interface InboxReadStateChangedParams {
    organizationId: string;
    userId: string;
    notificationId?: number;
    updatedCount?: number;
    state: 'unread' | 'read';
}

export function emitNotificationReadStateChanged(
    params: InboxReadStateChangedParams
): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Notification.ReadStateChanged', params},
        {organizationId: params.organizationId}
    );
}

export interface DeliveryUpdatedParams {
    organizationId: string;
    jobId: number;
    endpointId: number;
    state: string;
}

export function emitNotificationDeliveryUpdated(
    params: DeliveryUpdatedParams
): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Notification.DeliveryUpdated', params},
        {organizationId: params.organizationId}
    );
}

export interface EndpointAutoDisabledParams {
    organizationId: string;
    endpointId: number;
}

export function emitEndpointAutoDisabled(
    params: EndpointAutoDisabledParams
): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Channel.AutoDisabled', params},
        {organizationId: params.organizationId}
    );
}

export function emitEndpointHealthReset(
    params: EndpointAutoDisabledParams
): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Channel.HealthReset', params},
        {organizationId: params.organizationId}
    );
}
