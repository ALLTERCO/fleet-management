import log4js from 'log4js';
import {formatError} from '../util/formatError';
import type {DeviceIngressIdentity} from './deviceIngressRepository';
import {announceJobMove, moveJob} from './rotationJobMove';
import type {
    findOpenJobByCredential,
    RotationJob,
    recordJobCredential,
    resumeRecordedJob,
    setJobState
} from './rotationJobRepository';
import {tokenServerUrl} from './serverUrl';
import {
    cancelCredentialRotation,
    createPendingTokenCredential,
    type TokenCredentialRepository
} from './tokenCredentials';

const logger = log4js.getLogger('device-ingress-rotation');

interface LiveDevice {
    sendRPC(
        method: string,
        params: unknown,
        emitMessage: boolean,
        signal: AbortSignal
    ): Promise<unknown>;
}

export interface RotationRunnerDeps {
    jobs: {
        setJobState: typeof setJobState;
        recordJobCredential: typeof recordJobCredential;
        resumeRecordedJob: typeof resumeRecordedJob;
        findOpenJobByCredential: typeof findOpenJobByCredential;
    };
    credentials: TokenCredentialRepository;
    identities: {
        getIdentity(input: {
            organizationId: string;
            id: string;
        }): Promise<DeviceIngressIdentity | null>;
    };
    getDevice(externalId: string): LiveDevice | undefined;
    sendTimeoutMs(): number;
}

export async function runRotationJob(
    job: RotationJob,
    deps: RotationRunnerDeps
): Promise<RotationJob | null> {
    if (job.newCredentialId) return resumeRecordedKey(job, deps);
    const identity = await deps.identities.getIdentity({
        organizationId: job.organizationId,
        id: job.identityId
    });
    const externalId = identity?.expectedExternalId ?? null;
    const device = externalId ? deps.getDevice(externalId) : undefined;
    // No live socket means no way to hand over the new key, so never mint one.
    if (!device || !externalId) {
        logger.warn(
            'rotation job %s offline: %s',
            job.id,
            offlineReason(identity, externalId)
        );
        return moveJob(job, {setJobState: deps.jobs.setJobState}, 'failed', {
            errorCode: 'offline'
        });
    }
    const credential = await deps.jobs.recordJobCredential({
        jobId: job.id,
        mint: (repository) =>
            createPendingTokenCredential({
                organizationId: job.organizationId,
                identityId: job.identityId,
                repository
            })
    });
    // Settled or already holding a key since the claim; that owner finishes it.
    if (!credential) return null;
    const sent = await sendNewAddress(
        device,
        externalId,
        credential.tokenOnce,
        deps
    );
    if (!sent) {
        await cancelNewKeySafely(job, credential.id, deps);
        return moveJob(job, {setJobState: deps.jobs.setJobState}, 'failed', {
            errorCode: 'send_failed',
            newCredentialId: credential.id
        });
    }
    const moved = await moveJob(
        job,
        {setJobState: deps.jobs.setJobState},
        'sent',
        {newCredentialId: credential.id, markSent: true}
    );
    if (moved) return moved;
    // A re-claim that resumed this job already holds the key open; keep it.
    const open = await deps.jobs.findOpenJobByCredential({
        credentialId: credential.id
    });
    if (open?.side === 'new' && open.job.id === job.id) return open.job;
    // A cancel that landed mid-send owns the job now, so the key we just
    // minted belongs to nobody and must not stay usable.
    logger.warn(
        'rotation job %s was settled during the send; revoking key %s',
        job.id,
        credential.id
    );
    await cancelNewKeySafely(job, credential.id, deps);
    return null;
}

// The device may hold the recorded key: revoking could lock it out, minting would orphan it.
async function resumeRecordedKey(
    job: RotationJob,
    deps: RotationRunnerDeps
): Promise<RotationJob | null> {
    const resumed = await deps.jobs.resumeRecordedJob({id: job.id});
    if (resumed) {
        logger.warn(
            'rotation job %s resumed with its recorded key %s',
            job.id,
            job.newCredentialId
        );
        await announceJobMove(job, 'sent');
        return resumed;
    }
    // The job moved on, or its key is no longer pending and no device can use it.
    return moveJob(job, {setJobState: deps.jobs.setJobState}, 'failed', {
        errorCode: 'send_failed'
    });
}

function offlineReason(
    identity: DeviceIngressIdentity | null,
    externalId: string | null
): string {
    if (!identity) return 'identity not found';
    if (!externalId) return 'identity has no external id';
    return `no live socket for ${externalId}`;
}

async function sendNewAddress(
    device: LiveDevice,
    externalId: string,
    token: string,
    deps: RotationRunnerDeps
): Promise<boolean> {
    try {
        await device.sendRPC(
            'Ws.SetConfig',
            {config: {enable: true, server: tokenServerUrl(externalId, token)}},
            false,
            AbortSignal.timeout(deps.sendTimeoutMs())
        );
        return true;
    } catch (err) {
        logger.warn(
            'rotation send failed for %s: %s',
            externalId,
            formatError(err)
        );
        return false;
    }
}

async function cancelNewKeySafely(
    job: RotationJob,
    credentialId: string,
    deps: RotationRunnerDeps
): Promise<void> {
    try {
        await cancelCredentialRotation({
            organizationId: job.organizationId,
            params: {credentialId},
            repository: deps.credentials
        });
    } catch (err) {
        logger.error(
            'rotation cancel failed job=%s: %s',
            job.id,
            formatError(err)
        );
    }
}
