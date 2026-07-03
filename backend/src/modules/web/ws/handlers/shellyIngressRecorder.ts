import {createHash} from 'node:crypto';
import {tuning} from '../../../../config/tuning';
import {
    recordConnection,
    recordRejection
} from '../../../../modules/deviceIngress/deviceIngressRepository';
import {truncateSafeDetail} from '../../../../modules/deviceIngress/redaction';
import {rejectionSeverityFor} from '../../../../modules/deviceIngress/rejectionReasons';
import type {AdmissionIntent} from '../../../../modules/WaitingRoom';
import {normalizeIngressOrg} from '../../../../modules/WaitingRoom/defaultOrg';
import type {
    DeviceIngressConnectionResult,
    DeviceIngressRejectionReason
} from '../../../../types/api/deviceIngress';

export interface ShellyIngressRecorderDeps {
    recordConnection: typeof recordConnection;
    recordRejection: typeof recordRejection;
    config: () => ShellyIngressRecorderConfig;
}

const defaultDeps: ShellyIngressRecorderDeps = {
    recordConnection,
    recordRejection,
    config: readRecorderConfig
};

export interface ShellyIngressRecorderConfig {
    defaultOrganizationId: string;
    shellyTransport: 'ws' | 'wss';
    safeDetailBytes: number;
}

export interface ShellyIngressRecordInput {
    shellyID: string;
    intent?: AdmissionIntent;
    reasonCode?: DeviceIngressRejectionReason;
    detail?: unknown;
}

export interface ShellyIngressQueuedInput {
    shellyID: string;
    detail?: unknown;
}

export async function recordShellyIngressAccepted(
    input: ShellyIngressRecordInput,
    deps: ShellyIngressRecorderDeps = defaultDeps
): Promise<void> {
    const config = deps.config();
    const organizationId = organizationIdFor(input.intent, config);
    if (!organizationId) return;
    await deps.recordConnection(
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
    await deps.recordConnection(
        shellyConnectionInput(input, organizationId, 'rejected', config)
    );
    await deps.recordRejection({
        organizationId,
        reasonCode: input.reasonCode,
        severity: rejectionSeverityFor(input.reasonCode),
        reportedExternalId: input.shellyID,
        observedTransport: config.shellyTransport,
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
    await deps.recordConnection({
        organizationId,
        reportedExternalId: input.shellyID,
        observedTransport: config.shellyTransport,
        result: 'waiting_room',
        safeDetail: safeDetail(input.detail, config)
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
        reportedExternalId: input.shellyID,
        observedTransport: config.shellyTransport,
        result,
        reasonCode: input.reasonCode ?? null,
        remoteAddressHash: null,
        safeDetail: safeDetail(input.detail, config)
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
        shellyTransport: tuning.deviceIngress.shellyWsTransport,
        safeDetailBytes: tuning.deviceIngress.rejectionDetailMaxBytes
    };
}

export function hashRemoteAddress(
    remoteAddress: string | undefined
): string | null {
    if (!remoteAddress) return null;
    return createHash('sha256').update(remoteAddress, 'utf8').digest('hex');
}
