import type {
    DeviceIngressProfileId,
    DeviceIngressRejectionReason,
    DeviceIngressRiskLevel,
    DeviceIngressScopeKind,
    DeviceIngressSecurityModel,
    DeviceIngressTransport
} from '../../types/api/deviceIngress';
import type {
    DeviceIngressLookupCredential,
    DeviceIngressTokenLookupCredential
} from './deviceIngressRepository';
import {riskForIngress} from './riskPolicy';
import {hashIngressToken} from './tokenHash';
import {
    type DeviceIngressDeploymentPolicy,
    transportRejectionReason
} from './transportPolicy';

export interface TrustedConnectionContext {
    organizationId: string;
    identityId: string;
    // null for a grandfathered (credential-less) admit.
    credentialId: string | null;
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
}

export interface WaitingRoomCandidate {
    reportedExternalId: string;
    observedTransport: DeviceIngressTransport;
    securityModel: DeviceIngressSecurityModel;
    riskLevel: DeviceIngressRiskLevel;
    // Layer 2: cert chains to the FM CA — flag for one-click approve.
    trustedCa: boolean;
    // Set only for the enrollment-token path: the org the device must land in
    // comes from the token row, NEVER the device or the global default. A
    // suggested onboarding profile may accompany it (operator applies it).
    organizationId?: string | null;
    preferredProfileId?: DeviceIngressProfileId | null;
    waitingRoomRecorded?: boolean;
}

export interface RejectionCandidate {
    reasonCode: DeviceIngressRejectionReason;
    reportedExternalId: string | null;
    observedTransport: DeviceIngressTransport;
}

export type HandshakeEvaluation =
    | {result: 'accepted'; context: TrustedConnectionContext}
    // Already-approved credential-less device: admit via the legacy path (no
    // ingress identity). The gate maps this to record_only.
    | {result: 'known_device'}
    | {result: 'waiting_room'; entry: WaitingRoomCandidate}
    | {result: 'rejected'; rejection: RejectionCandidate};

export interface EvaluateHandshakeInput {
    reportedExternalId: string | null;
    /** Distinct per source (e.g. unknown:<ip-hash>) — a shared literal would
     *  collide rate limits, caps, and cooldown markers across devices. */
    fallbackExternalId?: string;
    observedTransport: DeviceIngressTransport;
    token: string | null;
    certificateFingerprint: string | null;
    // Leaf PEM of the presented cert — needed to verify the chain for Layer 2.
    certificatePem: string | null;
    waitingRoomEnabled: boolean;
    deploymentPolicy: DeviceIngressDeploymentPolicy;
    safeDetail?: Record<string, unknown>;
    // enforce_new admits approved credential-less devices; enforce_all does not.
    grandfatherKnownDevices: boolean;
}

export interface HandshakeLookupDeps {
    findTokenCredential(input: {
        tokenHash: string;
    }): Promise<DeviceIngressTokenLookupCredential | null>;
    findCertificateCredential(input: {
        fingerprint: string;
    }): Promise<DeviceIngressLookupCredential | null>;
    certificateChainsToFmCa(input: {certificatePem: string}): Promise<boolean>;
    // Leaf subject: CN binds the device id; O is the FM-CA-stamped owning org;
    // isCa rejects a CA cert masquerading as a device leaf.
    certificateSubject(input: {certificatePem: string}): {
        commonName: string | null;
        organization: string | null;
        isCa: boolean;
    } | null;
    deviceInScope(input: {
        organizationId: string;
        scopeKind: DeviceIngressScopeKind;
        scopeRef: string;
        externalId: string;
    }): Promise<boolean>;
    consumeEnrollmentTokenForWaitingRoom(input: {tokenHash: string}): Promise<{
        organizationId: string;
        preferredProfileId: DeviceIngressProfileId | null;
    } | null>;
    findEnrollmentTokenOrg(input: {
        tokenHash: string;
    }): Promise<{organizationId: string} | null>;
    isPendingInWaitingRoom(input: {
        organizationId: string;
        shellyID: string;
    }): Promise<boolean>;
    // Single source for "already approved": the device→org map (device.list).
    approvedDeviceOrg(reportedExternalId: string): string | undefined;
}

function fallbackId(input: EvaluateHandshakeInput): string {
    // An empty/whitespace src is as unidentified as a missing one — must not
    // collapse every blank-id device onto one shared key.
    const reported = input.reportedExternalId?.trim();
    if (reported) return reported;
    return input.fallbackExternalId ?? 'unknown';
}

export async function evaluateHandshake(
    input: EvaluateHandshakeInput,
    deps: HandshakeLookupDeps
): Promise<HandshakeEvaluation> {
    if (input.token) return evaluateTokenHandshake(input, deps);
    if (input.certificateFingerprint) {
        return evaluateCertificateHandshake(input, deps);
    }
    if (input.grandfatherKnownDevices) {
        const grandfathered = grandfatherEvaluation(input, deps);
        if (grandfathered) return grandfathered;
    }
    return unknownCredentialEvaluation(input);
}

// A credential-less device that is already an approved fleet device is let in
// by the id it reports. Single source: the device→org map (device.list). It
// admits via the legacy path (record_only) — no ingress identity. Unknown ids
// fall through to the waiting room; transport policy still gates it.
function grandfatherEvaluation(
    input: EvaluateHandshakeInput,
    deps: HandshakeLookupDeps
): HandshakeEvaluation | null {
    const reported = input.reportedExternalId?.trim();
    if (!reported) return null;
    if (!deps.approvedDeviceOrg(reported)) return null;
    const transport = input.observedTransport;
    const reason = transportRejectionReason({
        securityModel: 'direct_token',
        expectedTransport: transport,
        observedTransport: transport,
        riskLevel: riskForIngress({securityModel: 'direct_token', transport}),
        deploymentPolicy: input.deploymentPolicy
    });
    if (reason) return rejected(input, reason);
    return {result: 'known_device'};
}

async function evaluateTokenHandshake(
    input: EvaluateHandshakeInput,
    deps: HandshakeLookupDeps
): Promise<HandshakeEvaluation> {
    const credential = await deps.findTokenCredential({
        tokenHash: hashIngressToken(input.token ?? '')
    });
    if (!credential) return evaluateEnrollmentHandshake(input, deps);
    const reason = credentialRejectionReason(credential, 'token');
    if (reason) return rejected(input, reason);
    return acceptIfInScope(input, credential, 'direct_token', deps);
}

// A token matching no credential may be an enrollment token. Consume it
// atomically; on success the device lands in the TOKEN's org waiting room
// (never auto-trusted), carrying the suggested profile for the approver.
async function evaluateEnrollmentHandshake(
    input: EvaluateHandshakeInput,
    deps: HandshakeLookupDeps
): Promise<HandshakeEvaluation> {
    if (!input.waitingRoomEnabled) return rejected(input, 'device_not_bound');
    const tokenHash = hashIngressToken(input.token ?? '');
    const readmit = await reentryToWaitingRoom(input, tokenHash, deps);
    if (readmit) return readmit;
    const token = await deps.consumeEnrollmentTokenForWaitingRoom({tokenHash});
    if (!token) return rejected(input, 'token_revoked');
    return enrollmentWaitingRoom(
        input,
        token.organizationId,
        token.preferredProfileId
    );
}

// Single-use token already spent on first connect.
async function reentryToWaitingRoom(
    input: EvaluateHandshakeInput,
    tokenHash: string,
    deps: HandshakeLookupDeps
): Promise<HandshakeEvaluation | null> {
    const shellyID = input.reportedExternalId;
    if (!shellyID) return null;
    const peeked = await deps.findEnrollmentTokenOrg({tokenHash});
    if (!peeked) return null;
    const pending = await deps.isPendingInWaitingRoom({
        organizationId: peeked.organizationId,
        shellyID
    });
    if (!pending) return null;
    return enrollmentWaitingRoom(input, peeked.organizationId, null);
}

function enrollmentWaitingRoom(
    input: EvaluateHandshakeInput,
    organizationId: string,
    preferredProfileId: DeviceIngressProfileId | null
): HandshakeEvaluation {
    return {
        result: 'waiting_room',
        entry: {
            reportedExternalId: fallbackId(input),
            observedTransport: input.observedTransport,
            securityModel: 'direct_token',
            riskLevel: riskForIngress({
                securityModel: 'direct_token',
                transport: input.observedTransport
            }),
            trustedCa: false,
            organizationId,
            preferredProfileId,
            waitingRoomRecorded: true
        }
    };
}

async function evaluateCertificateHandshake(
    input: EvaluateHandshakeInput,
    deps: HandshakeLookupDeps
): Promise<HandshakeEvaluation> {
    const credential = await deps.findCertificateCredential({
        fingerprint: input.certificateFingerprint ?? ''
    });
    if (!credential) return trustedCaEvaluation(input, deps);
    const reason = credentialRejectionReason(credential, 'certificate');
    if (reason) return rejected(input, reason);
    return acceptIfInScope(input, credential, 'certificate', deps);
}

// A credential's identity is scoped to a single device, a group, or a location
// (null = org-wide). Enforce the connecting device falls inside that scope so a
// shared credential can't be replayed by a device outside its group/location.
async function acceptIfInScope(
    input: EvaluateHandshakeInput,
    credential: DeviceIngressLookupCredential,
    securityModel: DeviceIngressSecurityModel,
    deps: HandshakeLookupDeps
): Promise<HandshakeEvaluation> {
    if (!(await deviceInIdentityScope(input, credential, deps))) {
        return rejected(input, 'device_id_mismatch');
    }
    return accepted(input, credential, securityModel);
}

async function deviceInIdentityScope(
    input: EvaluateHandshakeInput,
    credential: DeviceIngressLookupCredential,
    deps: HandshakeLookupDeps
): Promise<boolean> {
    const src = input.reportedExternalId;
    const kind = credential.identityScopeKind;
    const expected = credential.identityExpectedExternalId;
    // device pin: explicit 'device', or a legacy identity that only set
    // expected_external_id without a scope kind.
    if (kind === 'device' || (kind === null && expected !== null)) {
        return src !== null && src === expected;
    }
    if (kind === 'group' || kind === 'location') {
        if (src === null || !credential.identityScopeRef) return false;
        return deps.deviceInScope({
            organizationId: credential.organizationId,
            scopeKind: kind,
            scopeRef: credential.identityScopeRef,
            externalId: src
        });
    }
    // No scope and no expected id → org-wide: any device in the org.
    return true;
}

// Layer 2: an unknown cert that chains to the FM CA is a new device we issued —
// flag it in the waiting room for one-click approve. Anything else stays a
// reject, exactly as before.
async function trustedCaEvaluation(
    input: EvaluateHandshakeInput,
    deps: HandshakeLookupDeps
): Promise<HandshakeEvaluation> {
    if (!input.certificatePem || !input.waitingRoomEnabled) {
        return rejected(input, 'certificate_revoked');
    }
    const chains = await deps.certificateChainsToFmCa({
        certificatePem: input.certificatePem
    });
    if (!chains) return rejected(input, 'certificate_revoked');
    const subject = deps.certificateSubject({
        certificatePem: input.certificatePem
    });
    // Defense in depth: a CA cert is never a device leaf, even if it chains
    // and carries clientAuth. FM stamps CA:FALSE, so this only fires on a
    // crafted or mis-issued cert.
    if (subject?.isCa) return rejected(input, 'device_not_bound');
    // FM-CA CN binds the device id; a mismatch is a sibling cert — fail closed.
    if (!certificateCnBindsDevice(subject, input.reportedExternalId)) {
        return rejected(input, 'device_id_mismatch');
    }
    // FM always stamps O; a chaining cert without one can't be tenant-resolved.
    const organizationId = subject?.organization ?? null;
    if (!organizationId) return rejected(input, 'device_not_bound');
    return {
        result: 'waiting_room',
        entry: {
            reportedExternalId: fallbackId(input),
            observedTransport: input.observedTransport,
            securityModel: 'certificate',
            riskLevel: 'strong',
            trustedCa: true,
            organizationId
        }
    };
}

function certificateCnBindsDevice(
    subject: {commonName: string | null} | null,
    reportedExternalId: string | null
): boolean {
    const cn = subject?.commonName ?? null;
    return (
        cn !== null &&
        reportedExternalId !== null &&
        cn.toLowerCase() === reportedExternalId.toLowerCase()
    );
}

function credentialRejectionReason(
    credential: DeviceIngressLookupCredential,
    kind: 'token' | 'certificate'
): DeviceIngressRejectionReason | null {
    if (credential.identityStatus === 'disabled') return 'identity_disabled';
    if (credential.identityStatus === 'quarantined') {
        return 'operator_quarantine';
    }
    if (credential.identityStatus !== 'active') return 'device_not_bound';
    if (credential.state === 'revoked') return revokedReason(kind);
    if (credential.state === 'expired') return expiredReason(kind);
    if (credential.state === 'superseded') {
        return 'credential_replay_suspected';
    }
    if (isBeforeValidityWindow(credential)) return notYetValidReason(kind);
    if (isAfterValidityWindow(credential)) return expiredReason(kind);
    return null;
}

function revokedReason(
    kind: 'token' | 'certificate'
): DeviceIngressRejectionReason {
    return kind === 'certificate' ? 'certificate_revoked' : 'token_revoked';
}

function expiredReason(
    kind: 'token' | 'certificate'
): DeviceIngressRejectionReason {
    return kind === 'certificate' ? 'certificate_expired' : 'token_expired';
}

function notYetValidReason(
    kind: 'token' | 'certificate'
): DeviceIngressRejectionReason {
    return kind === 'certificate'
        ? 'certificate_not_yet_valid'
        : 'pending_token_not_finalized';
}

function isBeforeValidityWindow(
    credential: DeviceIngressLookupCredential
): boolean {
    return (
        credential.notBefore !== null &&
        Date.parse(credential.notBefore) > Date.now()
    );
}

function isAfterValidityWindow(
    credential: DeviceIngressLookupCredential
): boolean {
    return (
        credential.notAfter !== null &&
        Date.parse(credential.notAfter) < Date.now()
    );
}

function unknownCredentialEvaluation(
    input: EvaluateHandshakeInput
): HandshakeEvaluation {
    if (!input.waitingRoomEnabled) return rejected(input, 'device_not_bound');
    return {
        result: 'waiting_room',
        entry: {
            reportedExternalId: fallbackId(input),
            observedTransport: input.observedTransport,
            securityModel: 'direct_token',
            riskLevel: riskForIngress({
                securityModel: 'direct_token',
                transport: input.observedTransport
            }),
            trustedCa: false
        }
    };
}

function accepted(
    input: EvaluateHandshakeInput,
    credential: DeviceIngressLookupCredential,
    securityModel: DeviceIngressSecurityModel
): HandshakeEvaluation {
    const reason = transportRejectionReason({
        securityModel: credential.identitySecurityModel,
        expectedTransport: credential.identityTransport,
        observedTransport: input.observedTransport,
        riskLevel: credential.identityRiskLevel,
        deploymentPolicy: input.deploymentPolicy
    });
    if (reason) return rejected(input, reason);
    return {
        result: 'accepted',
        context: connectionContext(credential, securityModel)
    };
}

function connectionContext(
    credential: DeviceIngressLookupCredential,
    securityModel: DeviceIngressSecurityModel
): TrustedConnectionContext {
    return {
        organizationId: credential.organizationId,
        identityId: credential.identityId,
        credentialId: credential.id,
        securityModel,
        transport: credential.identityTransport,
        riskLevel: credential.identityRiskLevel
    };
}

function rejected(
    input: EvaluateHandshakeInput,
    reasonCode: DeviceIngressRejectionReason
): HandshakeEvaluation {
    return {
        result: 'rejected',
        rejection: {
            reasonCode,
            reportedExternalId: input.reportedExternalId,
            observedTransport: input.observedTransport
        }
    };
}
