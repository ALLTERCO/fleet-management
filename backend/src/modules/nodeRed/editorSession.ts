// The Node-RED editor cookie holds a random session id, never the Fleet
// Manager token. Like Home Assistant's ingress session it has an idle end, a
// hard end, and carries the user it was opened for. Only a request that passes
// the normal Fleet Manager sign-in renews it, so it dies soon after that
// sign-in stops working. Only the id's hash is stored, so a store dump cannot
// be replayed as cookies.

import {createHash, randomBytes} from 'node:crypto';
import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import type {user_t} from '../../types';
import {BoundedMap} from '../boundedMap';
import type {NodeRedEditorSessionRecord, SessionSignal} from '../redis/ports';
import {nodeRedEditorSessions, sessionSignals} from '../redis/services';
import {attachEffectiveShape} from '../user/authShape';
import {onLocalUserSessionSignal} from '../user/sessionNotifications';
import {mayUseNodeRedEditor} from './editorAccess';
import {
    closeEditorTunnelsForSession,
    closeEditorTunnelsForUser,
    openEditorTunnelSessions
} from './editorTunnels';
import {nodeRedOrgAllows} from './orgLock';

const logger = log4js.getLogger('node-red-editor-session');

// A user may keep a few editor tabs or browsers; older sessions are dropped.
export const EDITOR_SESSIONS_PER_USER = 10;
// The permission recheck reads the policy store; once a minute is enough.
const ACCESS_RECHECK_MS = 60_000;
const ACCESS_RECHECK_MAX = 10_000;
const SESSION_ID_BYTES = 32;
// How late an open editor socket may notice that its session ended.
const SOCKET_SWEEP_MS = 30_000;
// Account, role and credential changes; a socket opening or closing is not one.
const REVOKING_SIGNALS: ReadonlySet<SessionSignal['kind']> = new Set([
    'force-disconnect',
    'auth-changed',
    'credential-revoked'
]);

export type EditorSessionRefusal =
    | 'expired'
    | 'wrongOrganization'
    | 'permissionLost';

export type EditorSessionCheck =
    | {ok: true; user: user_t}
    | {ok: false; refusal: EditorSessionRefusal};

export interface OpenedEditorSession {
    sessionId: string;
    /** Hard end of the session, in epoch ms. */
    expiresAt: number;
}

const recentAccess = new BoundedMap<string, user_t>({
    maxSize: ACCESS_RECHECK_MAX,
    ttlMs: ACCESS_RECHECK_MS
});

function editorSessionKey(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex');
}

function refused(refusal: EditorSessionRefusal): EditorSessionCheck {
    return {ok: false, refusal};
}

function remainingTtl(record: NodeRedEditorSessionRecord, now: number): number {
    return Math.min(tuning.nodeRed.sessionTtlMs, record.maxExpiresAt - now);
}

// A credential's shape is fixed by the credential; a sign-in's is re-resolved.
function editorPrincipal(user: user_t): user_t {
    const {effectiveShape, ...rest} = user;
    const keepShape = user.credentialId !== undefined && effectiveShape;
    return {...rest, password: '', ...(keepShape ? {effectiveShape} : {})};
}

function requireUserId(user: user_t): string {
    if (!user.userId) {
        throw new Error('Node-RED editor session needs a user id');
    }
    return user.userId;
}

function requireOrganization(user: user_t): string {
    if (!user.organizationId) {
        throw new Error('Node-RED editor session needs an organization');
    }
    return user.organizationId;
}

async function reusableRecord(
    presentedId: string | undefined,
    user: user_t
): Promise<NodeRedEditorSessionRecord | null> {
    if (!presentedId) return null;
    const record = await nodeRedEditorSessions.get(
        editorSessionKey(presentedId)
    );
    if (!record || record.maxExpiresAt <= Date.now()) return null;
    const sameHolder =
        record.userId === user.userId &&
        record.organizationId === user.organizationId;
    return sameHolder ? record : null;
}

function sessionRecord(input: {
    user: user_t;
    previous: NodeRedEditorSessionRecord | null;
}): NodeRedEditorSessionRecord {
    const {user, previous} = input;
    const now = Date.now();
    return {
        userId: requireUserId(user),
        username: user.username,
        ...(user.displayName ? {displayName: user.displayName} : {}),
        organizationId: requireOrganization(user),
        createdAt: previous?.createdAt ?? now,
        maxExpiresAt:
            previous?.maxExpiresAt ?? now + tuning.nodeRed.sessionMaxAgeMs,
        principal: editorPrincipal(user)
    };
}

/**
 * Opens an editor session for a freshly authenticated user. A still-valid
 * session the same user presents is refreshed in place instead.
 */
export async function openEditorSession(input: {
    user: user_t;
    presentedId?: string;
}): Promise<OpenedEditorSession> {
    const previous = await reusableRecord(input.presentedId, input.user);
    const sessionId =
        previous && input.presentedId
            ? input.presentedId
            : randomBytes(SESSION_ID_BYTES).toString('hex');
    const record = sessionRecord({user: input.user, previous});
    const key = editorSessionKey(sessionId);
    await nodeRedEditorSessions.put({
        key,
        record,
        ttlMs: remainingTtl(record, Date.now()),
        perUserMax: EDITOR_SESSIONS_PER_USER
    });
    recentAccess.delete(key);
    return {sessionId, expiresAt: record.maxExpiresAt};
}

// Every write caps the idle expiry at the hard end, so a stored record is
// always inside its lifetime. Reading never extends it.
async function liveRecord(
    key: string
): Promise<NodeRedEditorSessionRecord | null> {
    const record = await nodeRedEditorSessions.get(key);
    return record && record.maxExpiresAt > Date.now() ? record : null;
}

async function currentAccess(
    record: NodeRedEditorSessionRecord
): Promise<EditorSessionCheck> {
    const user = await attachEffectiveShape(record.principal);
    if (!(await mayUseNodeRedEditor(user))) return refused('permissionLost');
    return {ok: true, user};
}

async function recheckedAccess(
    key: string,
    record: NodeRedEditorSessionRecord
): Promise<EditorSessionCheck> {
    if (!nodeRedOrgAllows(record.organizationId)) {
        return refused('wrongOrganization');
    }
    const cached = recentAccess.get(key);
    if (cached) return {ok: true, user: cached};
    const access = await currentAccess(record);
    if (access.ok) recentAccess.set(key, access.user);
    return access;
}

/**
 * Validates a presented session without extending it, then rechecks that its
 * user may still use the editor. A refused session is deleted.
 */
export async function checkEditorSession(
    sessionId: string
): Promise<EditorSessionCheck> {
    const key = editorSessionKey(sessionId);
    const record = await liveRecord(key);
    if (!record) return refused('expired');
    const access = await recheckedAccess(key, record);
    if (!access.ok) await nodeRedEditorSessions.delete(key);
    return access;
}

/** Ends one session and its open sockets, e.g. on logout from this browser. */
export async function closeEditorSession(sessionId: string): Promise<void> {
    const key = editorSessionKey(sessionId);
    recentAccess.delete(key);
    closeEditorTunnelsForSession(sessionId);
    await nodeRedEditorSessions.delete(key);
}

/** Ends every session and open editor socket of the user. */
export async function revokeEditorSessionsForUser(
    userId: string
): Promise<void> {
    closeEditorTunnelsForUser(userId);
    await nodeRedEditorSessions.deleteForUser(userId);
}

/**
 * Ends every session of the user who holds the presented session, e.g. when
 * that browser's keepalive no longer passes the Fleet Manager sign-in.
 */
export async function revokeEditorSessionHolder(
    sessionId: string
): Promise<void> {
    const record = await nodeRedEditorSessions.get(editorSessionKey(sessionId));
    await closeEditorSession(sessionId);
    if (record) await revokeEditorSessionsForUser(record.userId);
}

// Unknown is not "no": a store outage keeps the socket until the next sweep.
async function sessionHasEnded(sessionId: string): Promise<boolean> {
    try {
        return !(await checkEditorSession(sessionId)).ok;
    } catch (error) {
        logger.warn('Node-RED editor socket check failed: %s', error);
        return false;
    }
}

/** Closes the open sockets whose session idled out, ended or lost access. */
export async function closeEndedEditorTunnels(): Promise<number> {
    let closed = 0;
    for (const sessionId of openEditorTunnelSessions()) {
        if (await sessionHasEnded(sessionId)) {
            closed += closeEditorTunnelsForSession(sessionId);
        }
    }
    return closed;
}

function sweepEditorTunnels(): void {
    closeEndedEditorTunnels().catch((error) => {
        logger.error('closing ended Node-RED editor sockets failed: %s', error);
    });
}

/** Revokes on account, role and credential changes, local or from a peer. */
export async function followUserSessionSignal(
    signal: Pick<SessionSignal, 'kind' | 'userId'>
): Promise<void> {
    if (!signal.userId || !REVOKING_SIGNALS.has(signal.kind)) return;
    await revokeEditorSessionsForUser(signal.userId);
}

function revokeOnSignal(signal: Pick<SessionSignal, 'kind' | 'userId'>): void {
    followUserSessionSignal(signal).catch((error) => {
        logger.error(
            'revoking Node-RED editor sessions of %s failed: %s',
            signal.userId,
            error
        );
    });
}

let revocationStarted = false;
let socketSweep: ReturnType<typeof setInterval> | null = null;

/**
 * Follows user signals from this instance and from peers, and closes sockets
 * of ended sessions; call once at boot.
 */
export async function startEditorSessionRevocation(): Promise<void> {
    if (revocationStarted) return;
    revocationStarted = true;
    socketSweep = setInterval(sweepEditorTunnels, SOCKET_SWEEP_MS);
    socketSweep.unref();
    onLocalUserSessionSignal(revokeOnSignal);
    await sessionSignals.on(revokeOnSignal);
}

/** Stops the socket sweep; signal listeners end with the process. */
export function stopEditorSocketSweep(): void {
    if (socketSweep) clearInterval(socketSweep);
    socketSweep = null;
}
