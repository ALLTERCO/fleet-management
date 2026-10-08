import type {
    DeviceIngressConnectionResult,
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';
import * as Observability from '../Observability';

export interface DeviceIngressMetricLabels {
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
}

export function recordConnectionMetric(input: {
    result: DeviceIngressConnectionResult;
    labels: DeviceIngressMetricLabels;
}): void {
    Observability.incrementLabeledCounter('device_ingress_connections_total', {
        result: input.result,
        security_model: input.labels.securityModel,
        transport: input.labels.transport,
        risk_level: input.labels.riskLevel
    });
}

export function recordRejectionMetric(input: {
    reason: string;
    severity: string;
    transport: DeviceIngressTransport;
}): void {
    Observability.incrementLabeledCounter('device_ingress_rejections_total', {
        reason: input.reason,
        severity: input.severity,
        transport: input.transport
    });
}

export function recordTokenRotationMetric(outcome: string): void {
    Observability.incrementLabeledCounter(
        'device_ingress_token_rotations_total',
        {outcome}
    );
}

export function recordCertificateBindingMetric(outcome: string): void {
    Observability.incrementLabeledCounter(
        'device_ingress_certificate_bindings_total',
        {outcome}
    );
}

export function recordRotationJobMetric(state: string): void {
    Observability.incrementLabeledCounter(
        'device_ingress_rotation_jobs_total',
        {state}
    );
}

export function recordProvisioningSessionMetric(input: {
    outcome: string;
    profile: string;
}): void {
    Observability.incrementLabeledCounter(
        'device_ingress_provisioning_sessions_total',
        {outcome: input.outcome, profile: input.profile}
    );
}

export function recordHandshakeDuration(ms: number): void {
    Observability.recordRpcTiming('device_ingress_handshake', ms);
    Observability.setGauge('device_ingress_handshake_duration_ms', ms);
}

export function recordMessageRateLimited(): void {
    Observability.incrementCounter('device_ingress_message_rate_limited_total');
}

export function setLiveConnections(input: {
    labels: DeviceIngressMetricLabels;
    count: number;
}): void {
    Observability.setLabeledGauge(
        'device_ingress_live_connections',
        {
            security_model: input.labels.securityModel,
            transport: input.labels.transport,
            risk_level: input.labels.riskLevel
        },
        input.count
    );
}

export function setWaitingRoomOpenCount(count: number): void {
    Observability.setGauge('device_ingress_waiting_room_open', count);
}
