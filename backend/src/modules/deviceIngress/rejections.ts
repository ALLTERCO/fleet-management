import RpcError from '../../rpc/RpcError';
import type {
    DeviceIngressRejectionReason,
    DeviceIngressRejectionResolveParams
} from '../../types/api/deviceIngress';
import type {
    DeviceIngressRejection,
    DeviceIngressWaitingRoomEntry
} from './deviceIngressRepository';
import {recommendedActionFor, rejectionSeverityFor} from './rejectionReasons';

export interface RejectionRepository {
    recordRejection(input: {
        organizationId: string;
        waitingRoomId?: string;
        reasonCode: DeviceIngressRejectionReason;
        severity: ReturnType<typeof rejectionSeverityFor>;
        reportedExternalId?: string | null;
        observedTransport?: string | null;
        safeDetail: Record<string, unknown>;
    }): Promise<DeviceIngressRejection>;
    resolveRejection(input: {
        organizationId: string;
        id: string;
        resolvedBy: string;
        note?: string;
    }): Promise<DeviceIngressRejection | null>;
}

export async function recordWaitingRoomRejection(input: {
    organizationId: string;
    waitingRoomId: string;
    reasonCode: DeviceIngressRejectionReason;
    detail?: string;
    entry: DeviceIngressWaitingRoomEntry;
    repository: RejectionRepository;
}): Promise<DeviceIngressRejection> {
    return input.repository.recordRejection({
        organizationId: input.organizationId,
        waitingRoomId: input.waitingRoomId,
        reasonCode: input.reasonCode,
        severity: rejectionSeverityFor(input.reasonCode),
        reportedExternalId: input.entry.reportedExternalId,
        observedTransport: input.entry.observedTransport,
        safeDetail: {
            detail: input.detail ?? recommendedActionFor(input.reasonCode)
        }
    });
}

export async function resolveRejection(input: {
    organizationId: string;
    params: DeviceIngressRejectionResolveParams;
    actor: string;
    repository: RejectionRepository;
}): Promise<DeviceIngressRejection> {
    const rejection = await input.repository.resolveRejection({
        organizationId: input.organizationId,
        id: input.params.id,
        resolvedBy: input.actor,
        note: input.params.note
    });
    if (!rejection) {
        throw RpcError.NotFound('deviceIngress.rejection', input.params.id);
    }
    return rejection;
}
