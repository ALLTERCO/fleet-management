import type {OperationJobKind, OperationJobSnapshot} from '../../types/api/job';
import * as EventDistributor from '../EventDistributor';

export interface JobUnitUpdatedEvent {
    jobId: string;
    kind: OperationJobKind;
    unitId: string;
    status: 'running' | 'done' | 'failed';
    deviceId?: string;
    phase?: string;
    progressPercent?: number;
    result?: unknown;
    error?: string;
}

export function emitJobUpdated(job: OperationJobSnapshot, orgId: string): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Job.Updated', params: {job}},
        {organizationId: orgId}
    );
}

export function emitJobUnitUpdated(
    event: JobUnitUpdatedEvent,
    orgId: string
): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Job.UnitUpdated', params: event},
        {organizationId: orgId}
    );
}
