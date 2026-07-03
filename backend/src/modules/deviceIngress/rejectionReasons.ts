import type {
    DeviceIngressRejectionReason,
    DeviceIngressRejectionSeverity
} from '../../types/api/deviceIngress';

export interface RejectionReasonMeta {
    severity: DeviceIngressRejectionSeverity;
    category: 'token' | 'certificate' | 'transport' | 'policy' | 'security';
    recommendedAction: string;
}

export const REJECTION_REASON_META: Record<
    DeviceIngressRejectionReason,
    RejectionReasonMeta
> = {
    token_expired: {
        severity: 'fixable',
        category: 'token',
        recommendedAction: 'rotate_token'
    },
    pending_token_not_finalized: {
        severity: 'fixable',
        category: 'token',
        recommendedAction: 'finalize_or_cancel_rotation'
    },
    certificate_expired: {
        severity: 'fixable',
        category: 'certificate',
        recommendedAction: 'rotate_certificate'
    },
    certificate_not_yet_valid: {
        severity: 'fixable',
        category: 'certificate',
        recommendedAction: 'check_device_time_or_certificate'
    },
    wrong_transport: {
        severity: 'fixable',
        category: 'transport',
        recommendedAction: 'apply_expected_transport_config'
    },
    legacy_ws_disabled: {
        severity: 'fixable',
        category: 'policy',
        recommendedAction: 'enable_legacy_ws_or_use_connector'
    },
    connection_cap_reached: {
        severity: 'fixable',
        category: 'policy',
        recommendedAction: 'close_old_connections_or_raise_cap'
    },
    rate_limit_exceeded: {
        severity: 'fixable',
        category: 'policy',
        recommendedAction: 'wait_or_adjust_rate_limit'
    },
    identity_disabled: {
        severity: 'fixable',
        category: 'policy',
        recommendedAction: 'enable_identity'
    },
    device_not_bound: {
        severity: 'fixable',
        category: 'policy',
        recommendedAction: 'bind_device_or_create_identity'
    },
    token_revoked: {
        severity: 'blocked',
        category: 'token',
        recommendedAction: 'create_new_token_if_trusted'
    },
    certificate_revoked: {
        severity: 'blocked',
        category: 'certificate',
        recommendedAction: 'replace_certificate_if_trusted'
    },
    certificate_cross_org: {
        severity: 'blocked',
        category: 'security',
        recommendedAction: 'investigate_cross_org_credential'
    },
    device_id_mismatch: {
        severity: 'blocked',
        category: 'security',
        recommendedAction: 'verify_device_identity'
    },
    blocked_ip: {
        severity: 'blocked',
        category: 'security',
        recommendedAction: 'review_ip_block'
    },
    operator_quarantine: {
        severity: 'blocked',
        category: 'policy',
        recommendedAction: 'clear_quarantine_if_safe'
    },
    credential_replay_suspected: {
        severity: 'blocked',
        category: 'security',
        recommendedAction: 'revoke_and_reissue_credential'
    },
    unknown_security_model: {
        severity: 'blocked',
        category: 'security',
        recommendedAction: 'review_ingress_policy'
    },
    malformed_handshake: {
        severity: 'blocked',
        category: 'security',
        recommendedAction: 'inspect_client_or_proxy'
    }
};

export function rejectionSeverityFor(
    reason: DeviceIngressRejectionReason
): DeviceIngressRejectionSeverity {
    return REJECTION_REASON_META[reason].severity;
}

export function recommendedActionFor(
    reason: DeviceIngressRejectionReason
): string {
    return REJECTION_REASON_META[reason].recommendedAction;
}
