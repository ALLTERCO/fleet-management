import {createHash} from 'node:crypto';
import {tuning} from '../../../../config/tuning';
import {recordRejection} from '../../../../modules/deviceIngress/deviceIngressRepository';
import {enqueueIngressConnection} from '../../../../modules/deviceIngress/ingressAuditBuffer';
import {truncateSafeDetail} from '../../../../modules/deviceIngress/redaction';
import {rejectionSeverityFor} from '../../../../modules/deviceIngress/rejectionReasons';
import type {AdmissionIntent} from '../../../../modules/WaitingRoom';
import {normalizeIngressOrg} from '../../../../modules/WaitingRoom/defaultOrg';
import type {
    DeviceIngressConnectionResult,
    DeviceIngressRejectionReason
} from '../../../../types/api/deviceIngress';

export interface ShellyIngressRecorderDeps {
    enqueueIngressConnection: typeof enqueueIngressConnection;
    recordRejection: typeof recordRejection;
    config: () => ShellyIngressRecorderConfig;
}

const defaultDeps: ShellyIngressRecorderDeps = {
    enqueueIngressConnection,
    recordRejection,
    config: readRecorderConfig
};

export interface ShellyIngressRecorderConfig {
    defaultOrganizationId: string;
    safeDetailBytes: number;
}

// transport is what the server observed on the device's socket.
export interface ShellyIngressRecordInput {
    shellyID: string;
    transport: 'ws' | 'wss';
    intent?: AdmissionIntent;
    reasonCode?: DeviceIngressRejectionReason;
    detail?: unknown;
}

export interface ShellyIngressQueuedInput {
    shellyID: string;
    transport: 'ws' | 'wss';
    detail?: unknown;
}

export async function recordShellyIngressAccepted(
    input: ShellyIngressRecordInput,
    deps: ShellyIngressRecorderDeps = defaultDeps
): Promise<void> {
    const config = deps.config();
    const organizationId = organizationIdFor(input.intent, config);
    if (!organizationId) return;
    await deps.enqueueIngressConnection(
        shellyConnectionInput(input, organizationId, 'accepted', config)
    );
}

export async function recordShellyIngressRejected(
    input: ShellyIngressRecordInput,
    deps: ShellyIngressRecorderDeps = defaultDeps
): Promise<void> {
    const config = deps.config();
    const organizationId = organizationIdFor(input.intent, config);
    if (!organizationId || !input.reasonCode) return;
    await deps.enqueueIngressConnection(
        shellyConnectionInput(input, organizationId, 'rejected', config)
    );
    await deps.recordRejection({
        organizationId,
        reasonCode: input.reasonCode,
        severity: rejectionSeverityFor(input.reasonCode),
        reportedExternalId: input.shellyID,
        observedTransport: input.transport,
        safeDetail: safeDetail(input.detail, config)
    });
}

// A new open device lives in the Redis waiting store, not the durable
// device_ingress_waiting_room table — only the connection trail is persisted.
export async function recordShellyIngressQueued(
    input: ShellyIngressQueuedInput,
    deps: ShellyIngressRecorderDeps = defaultDeps
): Promise<void> {
    const config = deps.config();
    const organizationId = normalizeIngressOrg(config.defaultOrganizationId);
    if (!organizationId) return;
    await deps.enqueueIngressConnection({
        organizationId,
        identityId: null,
        credentialId: null,
        reportedExternalId: input.shellyID,
        observedTransport: input.transport,
        result: 'waiting_room',
        reasonCode: null,
        remoteAddressHash: null,
        safeDetail: safeDetail(input.detail, config),
        userAgent: null
    });
}

function shellyConnectionInput(
    input: ShellyIngressRecordInput,
    organizationId: string,
    result: DeviceIngressConnectionResult,
    config: ShellyIngressRecorderConfig
) {
    return {
        organizationId,
        identityId: null,
        credentialId: null,
        reportedExternalId: input.shellyID,
        observedTransport: input.transport,
        result,
        reasonCode: input.reasonCode ?? null,
        remoteAddressHash: null,
        safeDetail: safeDetail(input.detail, config),
        userAgent: null
    };
}

function organizationIdFor(
    intent: AdmissionIntent | undefined,
    config: ShellyIngressRecorderConfig
): string | null {
    return (
        intent?.organization_id ??
        normalizeIngressOrg(config.defaultOrganizationId)
    );
}

function safeDetail(
    detail: unknown,
    config: ShellyIngressRecorderConfig
): Record<string, unknown> {
    if (detail === undefined) return {};
    return {detail: truncateSafeDetail(detail, config.safeDetailBytes)};
}

function readRecorderConfig(): ShellyIngressRecorderConfig {
    return {
        defaultOrganizationId: tuning.deviceIngress.defaultOrganizationId,
        safeDetailBytes: tuning.deviceIngress.rejectionDetailMaxBytes
    };
}

export function hashRemoteAddress(
    remoteAddress: string | undefined
): string | null {
    if (!remoteAddress) return null;
    return createHash('sha256').update(remoteAddress, 'utf8').digest('hex');
}
