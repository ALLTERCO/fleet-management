import RpcError from '../../rpc/RpcError';

export type RotationJobState =
    | 'queued'
    | 'sent'
    | 'waiting'
    | 'finalized'
    | 'failed'
    | 'cancelled';

export type RotationJobErrorCode =
    | 'offline'
    | 'not_applied'
    | 'send_failed'
    | 'cancelled_by_operator';

export const ROTATION_JOB_STATES: readonly RotationJobState[] = [
    'queued',
    'sent',
    'waiting',
    'finalized',
    'failed',
    'cancelled'
];

// A device that has been told to restart may still come back with either key.
export const ROTATION_JOB_OPEN_STATES: readonly RotationJobState[] = [
    'sent',
    'waiting'
];

export const ROTATION_JOB_CANCELLABLE_STATES: readonly RotationJobState[] = [
    'queued',
    'waiting'
];

const ALLOWED_TRANSITIONS: Record<
    RotationJobState,
    readonly RotationJobState[]
> = {
    queued: ['sent', 'failed', 'cancelled'],
    sent: ['finalized', 'failed', 'waiting', 'cancelled'],
    waiting: ['finalized', 'failed', 'cancelled'],
    finalized: [],
    failed: [],
    cancelled: []
};

export function assertRotationJobTransition(input: {
    from: RotationJobState;
    to: RotationJobState;
}): void {
    if (ALLOWED_TRANSITIONS[input.from].includes(input.to)) return;
    throw RpcError.Domain('ResourceConflict', {
        message: `invalid rotation job transition ${input.from} -> ${input.to}`,
        details: {
            resourceType: 'deviceIngress.rotationJob',
            from: input.from,
            to: input.to
        }
    });
}
