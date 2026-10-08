// Pure rules of the system proof that a person's credentials stop working
// after the identity provider stops the account. No I/O: the caller probes.

import RpcError from '../src/rpc/RpcError';
import {DOMAIN_ERRORS} from '../src/types/api/errors';

const UNAUTHORIZED_CODE = RpcError.Unauthorized().getErrorObject().code;

/** Slack on top of the account-state TTL for one poll and one request. */
export const REVOCATION_MARGIN_MS = 5_000;
export const REVOCATION_POLL_MS = 500;

export interface CredentialReply {
    httpStatus: number;
    rpcCode?: number;
    roles?: unknown;
    /** Answer to an RPC the credential could call before revocation. */
    privileged?: CredentialReply;
}

export interface AccessEndObservation {
    endedAfterMs: number;
    reply: CredentialReply;
}

export interface AccessEndWait {
    probe: () => Promise<CredentialReply>;
    boundMs: number;
    /** What counts as ended; a stable auth refusal unless stated. */
    ended?: (reply: CredentialReply) => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

/** The answer every interactive credential must give once access ended. */
export function isStableAuthRefusal(reply: CredentialReply): boolean {
    return reply.httpStatus === 401 && reply.rpcCode === UNAUTHORIZED_CODE;
}

function isPermissionDenied(reply: CredentialReply | undefined): boolean {
    return (
        reply?.httpStatus === 403 &&
        reply.rpcCode === DOMAIN_ERRORS.PermissionDenied.code
    );
}

function holdsNoFleetRole(reply: CredentialReply): boolean {
    if (reply.httpStatus !== 200 || !Array.isArray(reply.roles)) return false;
    return reply.roles.every((role) => role === 'none');
}

// A session without any Fleet role is admitted to the no-permissions page,
// and every privileged call it makes is denied.
export function sessionLostFleetAccess(reply: CredentialReply): boolean {
    if (isStableAuthRefusal(reply)) return true;
    return holdsNoFleetRole(reply) && isPermissionDenied(reply.privileged);
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until access has ended; fails once the bound has passed. */
export async function waitForAccessEnd(
    wait: AccessEndWait
): Promise<AccessEndObservation> {
    const ended = wait.ended ?? isStableAuthRefusal;
    const now = wait.now ?? Date.now;
    const sleep = wait.sleep ?? defaultSleep;
    const startedAt = now();
    const deadline = startedAt + wait.boundMs + REVOCATION_MARGIN_MS;
    for (;;) {
        const reply = await wait.probe();
        if (ended(reply)) return {endedAfterMs: now() - startedAt, reply};
        if (now() >= deadline) {
            throw new Error(
                `credential still answered HTTP ${reply.httpStatus} (RPC code ${
                    reply.rpcCode ?? 'none'
                }) ${now() - startedAt}ms after revocation; bound ${wait.boundMs}ms`
            );
        }
        await sleep(REVOCATION_POLL_MS);
    }
}
