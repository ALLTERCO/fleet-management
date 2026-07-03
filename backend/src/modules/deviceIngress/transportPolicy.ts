import RpcError from '../../rpc/RpcError';
import type {
    DeviceIngressRejectionReason,
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';

export interface DeviceIngressDeploymentPolicy {
    allowPlainWs: boolean;
}

export interface TransportPolicyInput {
    securityModel: DeviceIngressSecurityModel;
    expectedTransport: DeviceIngressTransport;
    observedTransport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
    deploymentPolicy: DeviceIngressDeploymentPolicy;
}

type TransportViolation =
    | 'certificate_on_plain_ws'
    | 'plain_ws_requires_legacy'
    | 'legacy_ws_disabled'
    | 'wrong_transport';

// Single source of the transport decision. assertTransportAllowed throws from
// it; the handshake reads the precise rejection reason from it (no try/catch).
function classifyTransportViolation(
    input: TransportPolicyInput
): TransportViolation | null {
    if (
        input.securityModel === 'certificate' &&
        input.observedTransport === 'ws'
    ) {
        return 'certificate_on_plain_ws';
    }
    if (input.observedTransport === 'ws') {
        if (input.riskLevel !== 'legacy') return 'plain_ws_requires_legacy';
        if (!input.deploymentPolicy.allowPlainWs) return 'legacy_ws_disabled';
    }
    if (input.expectedTransport !== input.observedTransport) {
        return 'wrong_transport';
    }
    return null;
}

const VIOLATION_REJECTION_REASON: Record<
    TransportViolation,
    DeviceIngressRejectionReason
> = {
    certificate_on_plain_ws: 'wrong_transport',
    plain_ws_requires_legacy: 'wrong_transport',
    legacy_ws_disabled: 'legacy_ws_disabled',
    wrong_transport: 'wrong_transport'
};

// The precise reason a connection's transport is rejected, or null when allowed.
export function transportRejectionReason(
    input: TransportPolicyInput
): DeviceIngressRejectionReason | null {
    const violation = classifyTransportViolation(input);
    return violation === null ? null : VIOLATION_REJECTION_REASON[violation];
}

export function assertTransportAllowed(input: TransportPolicyInput): void {
    const violation = classifyTransportViolation(input);
    if (violation !== null) throw transportViolationError(violation, input);
}

function transportViolationError(
    violation: TransportViolation,
    input: TransportPolicyInput
): RpcError {
    if (violation === 'certificate_on_plain_ws') {
        return RpcError.InvalidParams(
            'certificate ingress cannot use plain ws'
        );
    }
    if (violation === 'plain_ws_requires_legacy') {
        return RpcError.InvalidParams('plain ws ingress must be legacy risk');
    }
    if (violation === 'legacy_ws_disabled') {
        return RpcError.Domain('IngressRejected', {
            details: {reasonCode: 'legacy_ws_disabled'}
        });
    }
    return RpcError.Domain('IngressRejected', {
        details: {
            reasonCode: 'wrong_transport',
            expectedTransport: input.expectedTransport,
            observedTransport: input.observedTransport
        }
    });
}
