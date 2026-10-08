// Standing approvals: "you already said yes to this, do not ask again".
//
// Without this, an agent asked to run the lights every evening interrupts a
// human every single time, which trains people to approve without reading —
// the failure mode approval prompts exist to prevent. A standing approval is
// therefore scoped narrowly: it covers ONE method on ONE subject for ONE
// person, whichever duration is chosen.
//
// It is a convenience over the confirm step, never a widening of it. Policy,
// RBAC, the capability level, the rate budget and the audit trail all still
// run on every call; only the human prompt is skipped.
//
// Held in the shared consent store, so every instance honours a yes and a
// revoke on its next call. When the store cannot be read the person is asked
// again: a lost approval costs one prompt, never an unapproved action.

import {createHash} from 'node:crypto';
import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import type {
    McpStandingApprovalRecord,
    McpStandingApprovalScope,
    McpStandingApprovalsPort
} from '../redis/ports';
import {
    automationApprovalBinding,
    automationCreateMethods
} from './mcpGovernance.js';
import type {OperateCaller} from './types.js';

const logger = getLogger('mcpApprovals');

// Params that name the thing being acted on. A grant for one relay must not
// silently cover another, so the subject is part of the key.
const SUBJECT_KEYS = [
    'shellyID',
    'externalId',
    'deviceExternalId',
    'gatewayExternalId',
    'id',
    'tokenId',
    'userId',
    'organizationId'
] as const;

// Fields whose whole job is to differ between calls. Excluded from the digest
// so "run the lights every evening" is one grant, not one per state. Keep this
// list tiny: every entry is a field a human approved once and will never be
// asked about again.
const VOLATILE_PARAMS: Readonly<Record<string, readonly string[]>> = {
    'switch.set': ['on'],
    'light.set': ['on', 'brightness', 'transition'],
    'cover.gotoposition': ['pos'],
    'boolean.set': ['value'],
    'number.set': ['value'],
    'text.set': ['value']
};

// A 'forever' grant is long, not eternal: the store still expires it, so it
// never pins a slot of the bounded budget.
const FOREVER_MS = 365 * 24 * 60 * 60 * 1000;

/** One action of one person that a remembered yes may cover. */
export interface StandingApprovalTarget {
    id: string;
    key: string;
    organizationId: string;
    userId: string;
    username: string;
    method: string;
    subject: string;
}

export type GrantOutcome =
    | {stored: true; expiresAtMs: number}
    | {stored: false; reason: 'limit_reached'};

export type StandingApproval = McpStandingApprovalRecord;
export type StandingApprovalScope = McpStandingApprovalScope;

// Loaded on first use: the docs-only stdio server imports this module through
// the tool core but never remembers anything, and must not load the Redis and
// metrics runtime.
async function approvalStore(): Promise<McpStandingApprovalsPort> {
    return (await import('../redis/services.js')).mcpStandingApprovals;
}

// Recursively sorted so a re-ordered object — at any depth — digests the same.
// Without this, two identical actions produce two grants and the human is
// asked twice for the same thing.
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        const src = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(src).sort())
            out[key] = canonical(src[key]);
        return out;
    }
    return value;
}

// The readable part: which thing is being acted on. Kept as a prefix so a
// grant is still legible to a human reading the trail.
function subjectOf(params: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const key of SUBJECT_KEYS) {
        const value = params[key];
        if (value === undefined || value === null) continue;
        parts.push(`${key}=${String(value)}`);
    }
    return parts.join('&');
}

// The binding part: the exact arguments the human approved. A subject id alone
// is far too wide — it made "remove Bob from this group" also mean "remove
// everyone from this group".
function paramDigest(method: string, params: Record<string, unknown>): string {
    const volatileKeys = VOLATILE_PARAMS[method.trim().toLowerCase()] ?? [];
    const pinned: Record<string, unknown> = {};
    for (const key of Object.keys(params)) {
        if (volatileKeys.includes(key)) continue;
        pinned[key] = params[key];
    }
    return createHash('sha256')
        .update(JSON.stringify(canonical(pinned)))
        .digest('hex')
        .slice(0, 32);
}

// Methods that name their own binding pin only those params; a new flow's
// whole graph differs every time, so the default digest would never match.
function boundParams(
    method: string,
    params: Record<string, unknown>
): Record<string, unknown> {
    const binding = automationApprovalBinding(method);
    if (!binding) return params;
    const bound: Record<string, unknown> = {};
    for (const key of binding) {
        if (params[key] !== undefined) bound[key] = params[key];
    }
    return bound;
}

/**
 * What a remembered yes for this call would be bound to, or undefined when
 * nothing may be remembered: without a stable user id and an organization
 * there is no one to bind it to, and a username can be reused by someone else.
 */
export function standingApprovalTarget(
    caller: OperateCaller,
    method: string,
    params: Record<string, unknown>
): StandingApprovalTarget | undefined {
    if (!caller.userId || !caller.organizationId) return undefined;
    const bound = boundParams(method, params);
    const subject = subjectOf(bound);
    const normalizedMethod = method.trim().toLowerCase();
    const key = [
        caller.userId,
        caller.organizationId,
        normalizedMethod,
        subject ? `${subject}&` : '',
        `params=${paramDigest(method, bound)}`
    ].join('|');
    return {
        id: createHash('sha256').update(key).digest('hex'),
        key,
        organizationId: caller.organizationId,
        userId: caller.userId,
        username: caller.username,
        method: normalizedMethod,
        subject
    };
}

function holdsTarget(
    record: McpStandingApprovalRecord | null,
    target: StandingApprovalTarget,
    nowMs: number
): boolean {
    return (
        record !== null &&
        record.organizationId === target.organizationId &&
        record.userId === target.userId &&
        record.expiresAtMs > nowMs
    );
}

/** Is there a live yes for this exact action? An unreadable store is a no. */
export async function hasStandingApproval(
    target: StandingApprovalTarget,
    nowMs = Date.now()
): Promise<boolean> {
    try {
        return holdsTarget(
            await (await approvalStore()).get(target.id),
            target,
            nowMs
        );
    } catch (error) {
        logger.warn(
            'standing approval store unreadable, asking the person: %s',
            error instanceof Error ? error.message : String(error)
        );
        return false;
    }
}

/** Automation creates this caller already said "stop asking" for. */
export async function rememberedAutomationCreates(
    caller: OperateCaller
): Promise<string[]> {
    const remembered: string[] = [];
    for (const method of automationCreateMethods()) {
        const target = standingApprovalTarget(caller, method, {});
        if (target && (await hasStandingApproval(target))) {
            remembered.push(method);
        }
    }
    return remembered;
}

/** Remembers a yes. Throws when the store cannot be written. */
export async function grantStandingApproval(
    target: StandingApprovalTarget,
    scope: 'ttl' | 'forever' = 'ttl',
    nowMs = Date.now()
): Promise<GrantOutcome> {
    const expiresAtMs =
        scope === 'forever'
            ? nowMs + FOREVER_MS
            : nowMs + tuning.mcp.standingApprovalTtlMin * 60_000;
    const stored = await (await approvalStore()).grant(
        {
            id: target.id,
            organizationId: target.organizationId,
            userId: target.userId,
            username: target.username,
            method: target.method,
            subject: target.subject,
            scope,
            grantedAtMs: nowMs,
            expiresAtMs
        },
        tuning.mcp.maxStandingApprovals
    );
    return stored
        ? {stored: true, expiresAtMs}
        : {stored: false, reason: 'limit_reached'};
}

/** What is outstanding for one person, or for a whole organization. */
export async function listStandingApprovals(
    scope: StandingApprovalScope
): Promise<StandingApproval[]> {
    return (await approvalStore()).list(scope);
}

/** Takes one back, only within the given scope. */
export async function revokeStandingApproval(
    id: string,
    scope: StandingApprovalScope
): Promise<boolean> {
    return (await approvalStore()).revoke(id, scope);
}
