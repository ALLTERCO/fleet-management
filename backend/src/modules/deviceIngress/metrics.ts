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
    Observability.incrementCounter(
        metricName('fm_device_ingress_connections_total', [
            input.result,
            input.labels.securityModel,
            input.labels.transport,
            input.labels.riskLevel
        ])
    );
}

export function recordRejectionMetric(input: {
    reason: string;
    severity: string;
    transport: DeviceIngressTransport;
}): void {
    Observability.incrementCounter(
        metricName('fm_device_ingress_rejections_total', [
            input.reason,
            input.severity,
            input.transport
        ])
    );
}

export function recordTokenRotationMetric(outcome: string): void {
    Observability.incrementCounter(
        metricName('fm_device_ingress_token_rotations_total', [outcome])
    );
}

export function recordCertificateBindingMetric(outcome: string): void {
    Observability.incrementCounter(
        metricName('fm_device_ingress_certificate_bindings_total', [outcome])
    );
}

export function recordProvisioningSessionMetric(input: {
    outcome: string;
    profile: string;
}): void {
    Observability.incrementCounter(
        metricName('fm_device_ingress_provisioning_sessions_total', [
            input.outcome,
            input.profile
        ])
    );
}

export function recordHandshakeDuration(ms: number): void {
    Observability.recordRpcTiming('device_ingress_handshake', ms);
    Observability.setGauge('fm_device_ingress_handshake_duration_ms', ms);
}

export function recordMessageRateLimited(): void {
    Observability.incrementCounter(
        'fm_device_ingress_message_rate_limited_total'
    );
}

export function setLiveConnections(input: {
    labels: DeviceIngressMetricLabels;
    count: number;
}): void {
    Observability.setGauge(
        metricName('fm_device_ingress_live_connections', [
            input.labels.securityModel,
            input.labels.transport,
            input.labels.riskLevel
        ]),
        input.count
    );
}

export function setWaitingRoomOpenCount(count: number): void {
    Observability.setGauge('fm_device_ingress_waiting_room_open', count);
}

function metricName(prefix: string, values: readonly string[]): string {
    return [prefix, ...values].join('_');
}
