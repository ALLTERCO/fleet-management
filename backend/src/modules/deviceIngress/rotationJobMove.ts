import {logDeviceIngressAudit} from './audit';
import {recordRotationJobMetric} from './metrics';
import type {RotationJob, setJobState} from './rotationJobRepository';
import type {RotationJobErrorCode, RotationJobState} from './rotationJobState';

export const ROTATION_ACTOR = 'system:ingress-rotation-worker';

export interface RotationJobMoveDeps {
    setJobState: typeof setJobState;
}

export async function moveJob(
    job: RotationJob,
    deps: RotationJobMoveDeps,
    to: RotationJobState,
    extra: {
        errorCode?: RotationJobErrorCode;
        newCredentialId?: string;
        markSent?: boolean;
    } = {}
): Promise<RotationJob | null> {
    // The write is state-checked, so a racing hook that already moved the job wins.
    const moved = await deps.setJobState({
        id: job.id,
        from: job.state,
        to,
        ...extra
    });
    if (!moved) return null;
    await announceJobMove(job, to, extra.errorCode);
    return moved;
}

// Metric plus audit for a job that already moved, however it was written.
export async function announceJobMove(
    job: RotationJob,
    to: RotationJobState,
    errorCode?: RotationJobErrorCode
): Promise<void> {
    recordRotationJobMetric(to);
    await logDeviceIngressAudit({
        kind: 'rotation_job_state_changed',
        organizationId: job.organizationId,
        actor: ROTATION_ACTOR,
        subjectId: job.identityId,
        details: {
            jobId: job.id,
            batchId: job.batchId,
            from: job.state,
            to,
            errorCode: errorCode ?? null
        }
    });
}
