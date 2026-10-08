// Session state for MCP over HTTP: which sessions are live, and routing of a
// client's later message to the call it belongs to.
//
// The plain request/response path stays stateless: one POST in, one JSON reply
// out, no session required. Two client messages arrive on their own POST and
// must reach a call already running: an elicitation answer, and a
// `notifications/cancelled`. That correlation needs a session.
//
// Every session handed to a client is recorded here, so an ended or expired
// one is recognised. Each pending prompt and each cancellable call is a wait
// in the shared consent store, so the message may reach any instance: it is
// routed to the instance holding the call. The call itself can only wait in
// that one process; if the process is gone, no one can approve it and the
// call never runs.

import {createHash, randomUUID} from 'node:crypto';
import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import {getInstanceId} from '../redis/instanceId';
import type {McpElicitationDelivery, McpElicitationsPort} from '../redis/ports';
import {mcpElicitations} from '../redis/services';
import type {OperateCaller} from './types.js';

const logger = getLogger('mcpSessions');

export interface McpClientCapabilities {
    elicitation: boolean;
}

export interface ElicitationResult {
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, unknown>;
}

/** Who opened a session; only the same principal may use or answer it. */
export type ElicitationOwner = OperateCaller;

interface LocalWaiter {
    resolve: (value: ElicitationResult) => void;
    timer: NodeJS.Timeout;
}

const CANCEL: ElicitationResult = {action: 'cancel'};

// Call waits share the store with prompt waits; the prefix keeps a client's
// JSON-RPC id from ever naming a prompt the server sent.
const CALL_WAIT_PREFIX = 'call:';

function callWaitId(requestId: string | number): string {
    return `${CALL_WAIT_PREFIX}${JSON.stringify(requestId)}`;
}

function isCallWait(requestId: string): boolean {
    return requestId.startsWith(CALL_WAIT_PREFIX);
}

/** A request that a later `notifications/cancelled` can stop. */
export interface TrackedCall {
    signal: AbortSignal;
    release(): Promise<void>;
}

/** Digest of the principal; prompts, answers and waits are bound to it. */
export function bindingOf(owner: ElicitationOwner): string {
    return createHash('sha256')
        .update(
            JSON.stringify([
                owner.username,
                owner.userId ?? null,
                owner.organizationId,
                owner.credentialId ?? null
            ])
        )
        .digest('hex');
}

function sessionTtlMs(): number {
    return tuning.mcp.sessionTtlMin * 60_000;
}

function waiterKey(sessionId: string, requestId: string): string {
    return JSON.stringify([sessionId, requestId]);
}

// The payload crosses a trust boundary (it is whatever the client POSTed), and
// it decides whether an action runs. Anything that is not a well-formed
// answer resolves as a cancel: a malformed message is not consent.
export function asElicitationResult(value: unknown): ElicitationResult {
    if (typeof value !== 'object' || value === null) return CANCEL;
    const {action, content} = value as Partial<ElicitationResult>;
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') {
        return CANCEL;
    }
    return typeof content === 'object' && content !== null
        ? {action, content}
        : {action};
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Pairs prompts with answers for one backend instance. The waiting promises
 * are process-local; everything another instance needs is in the store.
 */
export class ElicitationBroker {
    readonly #store: McpElicitationsPort;
    readonly #instanceId: string;
    readonly #waiters = new Map<string, LocalWaiter>();
    readonly #calls = new Map<string, AbortController>();
    #listening: Promise<void> | undefined;

    constructor(store: McpElicitationsPort, instanceId: string) {
        this.#store = store;
        this.#instanceId = instanceId;
    }

    /** The new session id, or undefined when the session cap is reached. */
    async createSession(
        owner: ElicitationOwner,
        capabilities: McpClientCapabilities,
        id: string = randomUUID()
    ): Promise<string | undefined> {
        const created = await this.#store.createSession(
            {
                id,
                binding: bindingOf(owner),
                elicitation: capabilities.elicitation
            },
            {ttlMs: sessionTtlMs(), maxSessions: tuning.mcp.maxSessions}
        );
        if (created) return id;
        Observability.incrementCounter('mcp_session_limit_reached');
        return undefined;
    }

    /**
     * True while the owner's session exists. Throws when the store cannot say,
     * so the caller can answer "try again" rather than "session ended".
     */
    async isLiveSession(id: string, owner: ElicitationOwner): Promise<boolean> {
        const session = await this.#store.getSession(id, sessionTtlMs());
        return session?.binding === bindingOf(owner);
    }

    /** Only for the owner, and never when the store cannot say. */
    async supportsElicitation(
        id: string | undefined,
        owner: ElicitationOwner
    ): Promise<boolean> {
        if (!id) return false;
        try {
            const session = await this.#store.getSession(id, sessionTtlMs());
            return (
                session?.binding === bindingOf(owner) &&
                session.elicitation === true
            );
        } catch (error) {
            logger.warn(
                'elicitation session unreadable, not prompting: %s',
                describeError(error)
            );
            return false;
        }
    }

    /**
     * Registers a prompt before it is sent, so an answer can never arrive
     * ahead of its wait. Undefined when no answer could be routed back: then
     * the prompt must not be shown. The timeout resolves as 'cancel' so a
     * client that never answers cannot pin the call open.
     */
    async openElicitation(
        sessionId: string,
        owner: ElicitationOwner,
        requestId: string
    ): Promise<{answer: Promise<ElicitationResult>} | undefined> {
        if (!(await this.supportsElicitation(sessionId, owner)))
            return undefined;
        const timeoutMs = tuning.mcp.elicitTimeoutSec * 1000;
        const answer = this.#waitLocally(
            sessionId,
            owner,
            requestId,
            timeoutMs
        );
        try {
            await this.#listen();
            await this.#store.registerWait({
                sessionId,
                requestId,
                binding: bindingOf(owner),
                instanceId: this.#instanceId,
                expiresAtMs: Date.now() + timeoutMs
            });
        } catch (error) {
            logger.warn(
                'elicitation wait not stored, not prompting: %s',
                describeError(error)
            );
            await this.cancel(sessionId, owner, requestId);
            return undefined;
        }
        return {answer};
    }

    // Feeds a client's answer back to the waiting tool call, wherever it runs.
    // False when no call was waiting for it, so the route can answer honestly.
    async settle(
        sessionId: string | undefined,
        owner: ElicitationOwner,
        requestId: string,
        result: unknown
    ): Promise<boolean> {
        if (!sessionId || isCallWait(requestId)) return false;
        const wait = await this.#store.takeWait({
            sessionId,
            requestId,
            binding: bindingOf(owner)
        });
        if (!wait) return false;
        const answer = asElicitationResult(result);
        if (wait.instanceId === this.#instanceId) {
            return this.#resolveLocal(sessionId, requestId, answer);
        }
        return this.#store.deliver({
            instanceId: wait.instanceId,
            sessionId,
            requestId,
            result: answer
        });
    }

    /**
     * Makes a running request cancellable from any instance until released.
     * A call that cannot be registered still runs; it just cannot be
     * cancelled, which the spec allows.
     */
    async trackCall(
        sessionId: string,
        owner: ElicitationOwner,
        requestId: string | number
    ): Promise<TrackedCall> {
        const waitId = callWaitId(requestId);
        const key = waiterKey(sessionId, waitId);
        const controller = new AbortController();
        this.#calls.set(key, controller);
        const release = async () => {
            if (this.#calls.get(key) === controller) this.#calls.delete(key);
            await this.#forgetWait(sessionId, owner, waitId);
        };
        try {
            await this.#listen();
            await this.#store.registerWait({
                sessionId,
                requestId: waitId,
                binding: bindingOf(owner),
                instanceId: this.#instanceId,
                expiresAtMs: Date.now() + tuning.mcp.toolTimeoutSec * 1000
            });
        } catch (error) {
            logger.warn(
                'call not registered for cancellation, it runs to the end: %s',
                describeError(error)
            );
        }
        return {signal: controller.signal, release};
    }

    /** Stops the owner's running request, wherever it runs. */
    async cancelCall(
        sessionId: string,
        owner: ElicitationOwner,
        requestId: string | number,
        reason: string
    ): Promise<boolean> {
        const waitId = callWaitId(requestId);
        const wait = await this.#store.takeWait({
            sessionId,
            requestId: waitId,
            binding: bindingOf(owner)
        });
        if (!wait) return false;
        if (wait.instanceId === this.#instanceId) {
            return this.#abortLocal(sessionId, waitId, reason);
        }
        return this.#store.deliver({
            instanceId: wait.instanceId,
            sessionId,
            requestId: waitId,
            result: {action: 'cancel', content: {reason}}
        });
    }

    // Abandons a request nobody can answer any more — the client hung up.
    // Without this the tool call would hold its slot until the full timeout.
    async cancel(
        sessionId: string,
        owner: ElicitationOwner,
        requestId: string
    ): Promise<void> {
        this.#resolveLocal(sessionId, requestId, CANCEL);
        await this.#forgetWait(sessionId, owner, requestId);
    }

    /**
     * Drops a session and cancels anything still waiting on it, on whichever
     * instance. Scoped to the owner: one caller can never delete another's.
     */
    async deleteSession(id: string, owner: ElicitationOwner): Promise<boolean> {
        const waits = await this.#store.deleteSession(id, bindingOf(owner));
        if (waits === null) return false;
        for (const wait of waits) {
            if (wait.instanceId === this.#instanceId) {
                this.#settleLocal(wait.sessionId, wait.requestId, CANCEL);
                continue;
            }
            await this.#store.deliver({...wait, result: CANCEL});
        }
        return true;
    }

    /** Releases every local waiter unapproved, as a process exit would. */
    cancelAllLocal(): void {
        for (const waiter of this.#waiters.values()) {
            clearTimeout(waiter.timer);
            waiter.resolve(CANCEL);
        }
        this.#waiters.clear();
        for (const controller of this.#calls.values()) controller.abort();
        this.#calls.clear();
    }

    #listen(): Promise<void> {
        this.#listening ??= this.#store
            .onDelivery(this.#instanceId, (delivery) => this.#receive(delivery))
            .catch((error: unknown) => {
                this.#listening = undefined;
                throw error;
            });
        return this.#listening;
    }

    #receive(delivery: McpElicitationDelivery): void {
        this.#settleLocal(
            delivery.sessionId,
            delivery.requestId,
            asElicitationResult(delivery.result)
        );
    }

    // A wait is either a prompt (answered) or a call (aborted on any message).
    #settleLocal(
        sessionId: string,
        requestId: string,
        answer: ElicitationResult
    ): boolean {
        if (!isCallWait(requestId)) {
            return this.#resolveLocal(sessionId, requestId, answer);
        }
        const reason = answer.content?.reason;
        return this.#abortLocal(
            sessionId,
            requestId,
            typeof reason === 'string' ? reason : 'session ended'
        );
    }

    #abortLocal(sessionId: string, waitId: string, reason: string): boolean {
        const key = waiterKey(sessionId, waitId);
        const controller = this.#calls.get(key);
        if (!controller) return false;
        this.#calls.delete(key);
        controller.abort(reason);
        return true;
    }

    #waitLocally(
        sessionId: string,
        owner: ElicitationOwner,
        requestId: string,
        timeoutMs: number
    ): Promise<ElicitationResult> {
        return new Promise<ElicitationResult>((resolve) => {
            const timer = setTimeout(() => {
                void this.cancel(sessionId, owner, requestId);
            }, timeoutMs);
            timer.unref?.();
            this.#waiters.set(waiterKey(sessionId, requestId), {
                resolve,
                timer
            });
        });
    }

    async #forgetWait(
        sessionId: string,
        owner: ElicitationOwner,
        requestId: string
    ): Promise<void> {
        try {
            await this.#store.takeWait({
                sessionId,
                requestId,
                binding: bindingOf(owner)
            });
        } catch (error) {
            logger.warn(
                'elicitation wait not removed; it expires on its own: %s',
                describeError(error)
            );
        }
    }

    #resolveLocal(
        sessionId: string,
        requestId: string,
        answer: ElicitationResult
    ): boolean {
        const key = waiterKey(sessionId, requestId);
        const waiter = this.#waiters.get(key);
        if (!waiter) return false;
        this.#waiters.delete(key);
        clearTimeout(waiter.timer);
        waiter.resolve(answer);
        return true;
    }
}

let broker: ElicitationBroker | undefined;

/** This process's broker, over whichever consent store boot installed. */
export function elicitationBroker(): ElicitationBroker {
    broker ??= new ElicitationBroker(mcpElicitations, getInstanceId());
    return broker;
}

/** Test seam: every local waiter is released, as a restart would. */
export function _resetSessionsForTest(): void {
    broker?.cancelAllLocal();
    broker = undefined;
}
