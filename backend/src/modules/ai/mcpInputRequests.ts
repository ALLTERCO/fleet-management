// Approvals for clients on the stateless revision (2026-07-28).
//
// A session client is asked in the middle of the call: the server sends
// elicitation/create on the open stream and waits. A stateless client cannot
// be asked that way, so the call returns the question instead
// (resultType "input_required") and the client calls again with the answer.
// The approval decision itself is unchanged; only how the question travels.
//
// The state the client echoes back is attacker-controlled input that decides
// whether an action runs. It is signed, bound to the principal and to the
// exact call, expires with the elicitation timeout, and is claimed once in the
// shared consent store, so it cannot be replayed, moved to another call or
// presented by another key.

import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {getJwtToken} from '../../config/jwtSecret';
import {tuning} from '../../config/tuning';
import {stableJson} from '../authz/stableJson.js';
import type {OperateElicit} from './agentOperate.js';
import {buildElicitationParams, readElicitationAnswer} from './mcpElicit.js';
import {McpError} from './mcpErrors.js';
import {claimToken} from './mcpGovernance.js';
import {InputRequiredSignal} from './mcpProtocolEra.js';
import {
    asElicitationResult,
    bindingOf,
    type ElicitationOwner
} from './mcpSessions.js';

// Domain separation from every other HMAC over the same secret.
const PURPOSE = 'mcp-input-required-v1:';
// The one question Fleet asks; its key in inputRequests and inputResponses.
export const APPROVAL_INPUT_KEY = 'fleet_approval';

interface RequestStatePayload {
    v: 1;
    /** Principal binding. */
    b: string;
    /** Digest of the tool name and arguments. */
    c: string;
    /** Digest of the prompt the human was shown. */
    p: string;
    /** Makes every state unique, so each is claimed on its own. */
    n: string;
    iat: number;
    exp: number;
}

/** The tools/call this approval belongs to, and who makes it. */
export interface ApprovalCall {
    owner: ElicitationOwner;
    tool: string;
    args: Record<string, unknown>;
    protocolVersion: string;
}

/** What a retry brought back, exactly as the client sent it. */
export interface ApprovalRetry {
    inputResponses?: unknown;
    requestState?: unknown;
}

function digest(value: unknown): string {
    return createHash('sha256').update(stableJson(value)).digest('hex');
}

function mac(encoded: string): string {
    return createHmac('sha256', getJwtToken())
        .update(PURPOSE + encoded)
        .digest('base64url');
}

function sameText(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

function callDigest(call: ApprovalCall): string {
    return digest([call.tool, call.args]);
}

function promptDigest(prompt: Parameters<OperateElicit>[0]): string {
    return digest([prompt.message, prompt.method, prompt.allowRemember]);
}

function invalidState(message: string): McpError {
    return new McpError('invalid_request_state', message, {retryable: false});
}

function signState(call: ApprovalCall, prompt: string): string {
    const issuedAt = Date.now();
    const payload: RequestStatePayload = {
        v: 1,
        b: bindingOf(call.owner),
        c: callDigest(call),
        p: prompt,
        n: randomUUID(),
        iat: issuedAt,
        exp: issuedAt + tuning.mcp.elicitTimeoutSec * 1000
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${mac(encoded)}`;
}

function decodeState(state: unknown): RequestStatePayload {
    if (typeof state !== 'string') {
        throw invalidState('requestState must be the string this server sent');
    }
    const [encoded, signature, extra] = state.split('.');
    if (!encoded || !signature || extra !== undefined) {
        throw invalidState('requestState is malformed');
    }
    if (!sameText(signature, mac(encoded))) {
        throw invalidState('requestState was not issued by this server');
    }
    try {
        return JSON.parse(
            Buffer.from(encoded, 'base64url').toString('utf8')
        ) as RequestStatePayload;
    } catch {
        throw invalidState('requestState is malformed');
    }
}

/**
 * The verified payload, or invalid_request_state: a state from another
 * principal, another call, or past its expiry is never accepted.
 */
function verifyState(state: unknown, call: ApprovalCall): RequestStatePayload {
    const payload = decodeState(state);
    if (
        payload.v !== 1 ||
        typeof payload.p !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
    ) {
        throw invalidState('requestState is malformed');
    }
    if (payload.b !== bindingOf(call.owner)) {
        throw invalidState('requestState belongs to another principal');
    }
    if (payload.c !== callDigest(call)) {
        throw invalidState('requestState belongs to another call');
    }
    if (payload.exp <= Date.now()) {
        throw invalidState('requestState has expired; call again without it');
    }
    return payload;
}

// One use per state, enforced in the shared store; a store that cannot say
// refuses the state (claimToken fails closed).
async function claimState(
    state: string,
    payload: RequestStatePayload
): Promise<void> {
    try {
        await claimToken(state, {
            issuedAtMs: payload.iat,
            expiresAtMs: payload.exp
        });
    } catch (error) {
        if (
            error instanceof McpError &&
            error.reason === 'invalid_confirmation'
        ) {
            throw invalidState(
                'requestState was already used; call again without it'
            );
        }
        throw error;
    }
}

function readResponses(value: unknown): Record<string, unknown> {
    if (value === undefined) return {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new McpError(
            'invalid_params',
            'inputResponses must be an object keyed by input request'
        );
    }
    return value as Record<string, unknown>;
}

/**
 * Whether a retry carries state this server issued for this principal and
 * this exact call, still unexpired. It does not claim the state: the retry's
 * own readApprovalRetry does, and refuses one already used.
 */
export function retryCarriesIssuedState(
    call: ApprovalCall,
    requestState: unknown
): boolean {
    if (requestState === undefined) return false;
    try {
        verifyState(requestState, call);
        return true;
    } catch (error) {
        if (
            error instanceof McpError &&
            error.reason === 'invalid_request_state'
        )
            return false;
        throw error;
    }
}

/**
 * Checks what a retry brought back and returns the human's answer to the
 * prompt it was given for. A retry without state carries no answer: an
 * unsigned answer is never consent. Throws invalid_request_state for a state
 * that fails verification or was already used.
 */
export async function readApprovalRetry(
    call: ApprovalCall,
    retry: ApprovalRetry
): Promise<{prompt: string; response: unknown} | undefined> {
    const responses = readResponses(retry.inputResponses);
    if (retry.requestState === undefined) return undefined;
    const payload = verifyState(retry.requestState, call);
    await claimState(String(retry.requestState), payload);
    return {prompt: payload.p, response: responses[APPROVAL_INPUT_KEY]};
}

/**
 * How the operate layer asks a stateless client. With the answer to this
 * exact prompt in hand it returns it once; otherwise it ends the call with the
 * question and a fresh signed state.
 */
export function approvalElicitor(
    call: ApprovalCall,
    answered: {prompt: string; response: unknown} | undefined
): OperateElicit {
    let pending = answered;
    const elicit: OperateElicit = async (prompt) => {
        const asked = promptDigest(prompt);
        const answer = pending;
        pending = undefined;
        if (
            answer &&
            answer.prompt === asked &&
            answer.response !== undefined
        ) {
            return readElicitationAnswer(asElicitationResult(answer.response));
        }
        throw new InputRequiredSignal(
            {
                [APPROVAL_INPUT_KEY]: {
                    method: 'elicitation/create',
                    params: {
                        mode: 'form',
                        ...buildElicitationParams(prompt.message, {
                            allowRemember: prompt.allowRemember,
                            protocolVersion: call.protocolVersion
                        })
                    }
                }
            },
            signState(call, asked)
        );
    };
    return Object.assign(elicit, {
        answersRetry: answered?.response !== undefined
    });
}
