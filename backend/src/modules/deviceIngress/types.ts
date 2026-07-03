import type {
    DeviceIngressCredentialState,
    DeviceIngressIdentityState,
    DeviceIngressProfileId,
    DeviceIngressRejectionReason,
    DeviceIngressRiskLevel,
    DeviceIngressSecurityModel,
    DeviceIngressSubjectType,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';

export interface TrustedConnectionContext {
    organizationId: string;
    identityId: string;
    credentialId: string;
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
}

export interface WaitingRoomCandidate {
    organizationId: string;
    reportedExternalId: string;
    observedTransport: DeviceIngressTransport;
    securityModel: DeviceIngressSecurityModel;
    riskLevel: DeviceIngressRiskLevel;
    profileId?: DeviceIngressProfileId;
    safeDetail: Record<string, unknown>;
}

export interface RejectionCandidate {
    organizationId: string;
    reasonCode: DeviceIngressRejectionReason;
    reportedExternalId?: string | null;
    observedTransport?: DeviceIngressTransport | null;
    identityId?: string | null;
    credentialId?: string | null;
    waitingRoomId?: string | null;
    safeDetail: Record<string, unknown>;
}

export interface ConnectorRepresentedDevice {
    connectorIdentityId: string;
    childExternalId: string;
    protocol: DeviceIngressTransport;
    subjectType: DeviceIngressSubjectType;
}

export interface CredentialLifecycleInput {
    organizationId: string;
    credentialId: string;
}

export interface IdentityLifecycleInput {
    organizationId: string;
    identityId: string;
}

export interface StateChange<TState extends string> {
    from: TState;
    to: TState;
}

export type IdentityStateChange = StateChange<DeviceIngressIdentityState>;
export type CredentialStateChange = StateChange<DeviceIngressCredentialState>;
