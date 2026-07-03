// Certificate.PushRow / Certificate.JobUpdated WS emitters. orgId tags
// the fanout so non-provider support listeners in other tenants are skipped.

import type {
    CertificateJobResponse,
    CertificatePushRow
} from '../../types/api/certificate';
import * as EventDistributor from '../EventDistributor';

export interface PushRowEvent {
    jobId: string;
    row: CertificatePushRow;
}

export function emitPushRow(
    jobId: string,
    row: CertificatePushRow,
    orgId: string
): void {
    const params: PushRowEvent = {jobId, row};
    EventDistributor.processAndNotifyAll(
        {method: 'Certificate.PushRow', params},
        {organizationId: orgId}
    );
}

export function emitJobUpdated(
    job: CertificateJobResponse,
    orgId: string
): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Certificate.JobUpdated', params: {job}},
        {organizationId: orgId}
    );
}
