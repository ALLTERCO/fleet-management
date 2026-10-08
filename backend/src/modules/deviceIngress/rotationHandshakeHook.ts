import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {formatError} from '../util/formatError';
import {closeCredentialConnections} from './connectionRegistry';
import {invalidateCredential, invalidateIdentity} from './deviceTrustCache';
import {announceJobMove} from './rotationJobMove';
import {
    findOpenJobByCredential,
    type RotationJob,
    settleJobFinalized,
    settleJobRevokingKey
} from './rotationJobRepository';

const logger = log4js.getLogger('device-ingress-rotation');

export interface RotationHookDeps {
    findOpenJobByCredential: typeof findOpenJobByCredential;
    settleJobFinalized: (input: {
        jobId: string;
        newCredentialId: string;
    }) => Promise<RotationJob | null>;
    settleJobRevokingKey: typeof settleJobRevokingKey;
    invalidateCredential: typeof invalidateCredential;
    invalidateIdentity: typeof invalidateIdentity;
    closeCredentialConnections: typeof closeCredentialConnections;
}

const liveDeps: RotationHookDeps = {
    findOpenJobByCredential,
    settleJobFinalized: (input) => settleJobFinalized(input),
    settleJobRevokingKey: (input) => settleJobRevokingKey(input),
    invalidateCredential,
    invalidateIdentity,
    closeCredentialConnections
};

export type RotationSettleOutcome = 'finalized' | 'failed' | 'none';

export async function settleRotationOnAccept(
    input: {
        organizationId: string;
        identityId: string;
        credentialId: string | null;
    },
    deps: RotationHookDeps = liveDeps
): Promise<RotationSettleOutcome> {
    if (!tuning.deviceIngress.rotationEnabled) return 'none';
    if (!input.credentialId) return 'none';
    const found = await deps.findOpenJobByCredential({
        credentialId: input.credentialId
    });
    if (!found) return 'none';
    // Cross-org rows never settle here; the handshake already scoped the accept.
    if (found.job.organizationId !== input.organizationId) return 'none';
    if (found.side === 'new') return finalize(found.job, deps);
    return failNotApplied(found.job, deps);
}

async function finalize(
    job: RotationJob,
    deps: RotationHookDeps
): Promise<RotationSettleOutcome> {
    // Side 'new' matched on this column, so it is never null here.
    if (!job.newCredentialId) return 'none';
    const settled = await deps.settleJobFinalized({
        jobId: job.id,
        newCredentialId: job.newCredentialId
    });
    // Another reconnect already settled this job; it owns the announcement.
    if (!settled) return 'none';
    await announceJobMove(job, 'finalized');
    await deps.invalidateCredential({
        credentialId: job.newCredentialId,
        identityId: job.identityId
    });
    await deps.invalidateIdentity(job.identityId);
    // Only sockets still on the old key are closed, never the device that just
    // came back on the new one.
    deps.closeCredentialConnections(
        job.oldCredentialId,
        'credential_finalized'
    );
    return 'finalized';
}

async function failNotApplied(
    job: RotationJob,
    deps: RotationHookDeps
): Promise<RotationSettleOutcome> {
    // Ws.SetConfig only applies after the restart, so an old-key reconnect
    // from a job still in 'sent' is a network blip, not a refused rotation.
    if (job.state !== 'waiting') return 'none';
    const newCredentialId = job.newCredentialId;
    const settled = await deps.settleJobRevokingKey({
        jobId: job.id,
        newCredentialId,
        from: ['waiting'],
        to: 'failed',
        errorCode: 'not_applied'
    });
    // Another reconnect already settled this job; it owns the announcement.
    if (!settled) return 'none';
    await announceJobMove(job, 'failed', 'not_applied');
    // No new key was ever minted, so there is no credential cache to evict.
    if (newCredentialId) {
        await deps.invalidateCredential({
            credentialId: newCredentialId,
            identityId: job.identityId
        });
    }
    await deps.invalidateIdentity(job.identityId);
    if (newCredentialId) {
        deps.closeCredentialConnections(
            newCredentialId,
            'credential_rotation_cancelled'
        );
    }
    return 'failed';
}

// Fire-and-forget wrapper for the gate: a hook error must never block a device.
export function settleRotationOnAcceptSafely(input: {
    organizationId: string;
    identityId: string;
    credentialId: string | null;
}): void {
    void settleRotationOnAccept(input).catch((err) =>
        logger.error(
            'rotation settle failed identity=%s: %s',
            input.identityId,
            formatError(err)
        )
    );
}
