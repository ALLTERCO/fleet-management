export type DeviceIngressAuditKind =
    | 'identity_created'
    | 'identity_updated'
    | 'identity_disabled'
    | 'identity_quarantined'
    | 'credential_created'
    | 'credential_rotated'
    | 'credential_finalized'
    | 'credential_cancelled'
    | 'credential_revoked'
    | 'enrollment_token_created'
    | 'enrollment_token_revoked'
    | 'waiting_room_approved'
    | 'waiting_room_rejected'
    | 'rejection_resolved'
    | 'connection_disconnected'
    | 'setup_plan_created'
    | 'setup_bundle_fetched'
    | 'setup_apply_reported'
    | 'handshake_accepted'
    | 'handshake_waiting_room'
    | 'handshake_rejected';

export interface DeviceIngressAuditEvent {
    kind: DeviceIngressAuditKind;
    organizationId: string;
    actor: string;
    subjectId?: string;
    details: Record<string, unknown>;
}

export function buildDeviceIngressAuditEvent(input: {
    kind: DeviceIngressAuditKind;
    organizationId: string;
    actor?: string | null;
    subjectId?: string;
    details?: Record<string, unknown>;
}): DeviceIngressAuditEvent {
    return {
        kind: input.kind,
        organizationId: input.organizationId,
        actor: input.actor ?? 'unknown',
        subjectId: input.subjectId,
        details: input.details ?? {}
    };
}

export async function logDeviceIngressAudit(input: {
    kind: DeviceIngressAuditKind;
    organizationId: string;
    actor?: string | null;
    subjectId?: string;
    details?: Record<string, unknown>;
    success?: boolean;
}): Promise<void> {
    // Lazy import keeps pure workflow tests independent from runtime metadata.
    const AuditLogger = await import('../AuditLogger.js');
    const event = buildDeviceIngressAuditEvent(input);
    await AuditLogger.log({
        eventType: 'device_ingress',
        username: event.actor,
        method: `deviceIngress.${event.kind}`,
        params: {
            subjectId: event.subjectId,
            ...event.details
        },
        success: input.success ?? true,
        organizationId: event.organizationId
    });
}
