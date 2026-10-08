// What the Node-RED screens show, decided from the session reply, the
// automation.GetStatus check and automation RPC errors. Pure, so every state
// is testable.

import type {AutomationStatusResult} from '@/api/automationRpc';
import {
    domainErrorKind,
    domainErrorReason,
    formatRpcError
} from '@/helpers/domainErrors';

export type NodeRedAccessState =
    | 'loading'
    | 'ready'
    | 'no-token'
    | 'session-expired'
    | 'no-access'
    | 'wrong-org'
    | 'misconfigured'
    | 'down';

export type NodeRedProblemState = Exclude<
    NodeRedAccessState,
    'loading' | 'ready'
>;

export interface NodeRedAccessMessage {
    icon: string;
    title: string;
    detail: string;
    canRetry: boolean;
}

export interface SessionReply {
    status: number;
    /** The `code` from the JSON error body, when the server sent one. */
    code: string | null;
}

export const NODE_RED_ACCESS_MESSAGES: Record<
    NodeRedProblemState,
    NodeRedAccessMessage
> = {
    'no-token': {
        icon: 'fas fa-right-to-bracket',
        title: 'Sign in to use Node-RED',
        detail: 'Your session has no sign-in token. Sign in again, then reload this page.',
        canRetry: true
    },
    'session-expired': {
        icon: 'fas fa-clock-rotate-left',
        title: 'Your editor session has ended',
        detail: 'The Node-RED editor closes after a while without use, or when your account changes. Reopen it to continue.',
        canRetry: true
    },
    'no-access': {
        icon: 'fas fa-lock',
        title: "You don't have access to Node-RED",
        detail: 'Ask an administrator for permission to manage automations.',
        canRetry: false
    },
    'wrong-org': {
        icon: 'fas fa-building-lock',
        title: 'This Node-RED belongs to another organization',
        detail: 'Switch to the organization that owns it to see and change its flows.',
        canRetry: false
    },
    misconfigured: {
        icon: 'fas fa-screwdriver-wrench',
        title: "Node-RED isn't set up correctly",
        detail: 'Fleet Manager cannot connect to Node-RED with its current settings. Contact your administrator.',
        canRetry: false
    },
    down: {
        icon: 'fas fa-plug-circle-exclamation',
        title: 'Node-RED is down',
        detail: 'Fleet Manager could not reach the Node-RED editor. It may be restarting.',
        canRetry: true
    }
};

// Same code on proxy JSON replies and on automation RPC refusals.
const WRONG_ORGANIZATION_CODE = 'node_red_wrong_organization';

// The server could not check a keepalive; not an answer about the user.
const SESSION_UNCHECKED_CODE = 'node_red_session_unavailable';

// Stable codes sent by the backend Node-RED proxy.
const STATE_BY_CODE: Record<string, NodeRedProblemState> = {
    node_red_session_expired: 'session-expired',
    node_red_sign_in_required: 'no-token',
    node_red_permission_required: 'no-access',
    node_red_organization_required: 'no-access',
    node_red_unavailable: 'down',
    [WRONG_ORGANIZATION_CODE]: 'wrong-org',
    node_red_misconfigured: 'misconfigured',
    node_red_bad_path: 'misconfigured'
};

// Uncoded replies; 404 is the backend saying Node-RED is switched off.
const STATE_BY_STATUS: Record<number, NodeRedProblemState> = {
    401: 'no-token',
    403: 'no-access',
    404: 'misconfigured'
};

/** The page state that matches a reply from the session endpoint. */
export function accessStateForSessionReply(
    reply: SessionReply
): NodeRedAccessState {
    if (reply.status >= 200 && reply.status < 300) return 'ready';
    const byCode = reply.code ? accessStateForCode(reply.code) : null;
    return byCode ?? STATE_BY_STATUS[reply.status] ?? 'down';
}

/** True when a keepalive reply says nothing about the user's access. */
export function isUncheckedSessionReply(reply: SessionReply): boolean {
    return reply.code === SESSION_UNCHECKED_CODE;
}

/** The page state for a proxy error code, or null for an unknown code. */
export function accessStateForCode(code: string): NodeRedProblemState | null {
    return STATE_BY_CODE[code] ?? null;
}

export interface EditorFrameDocument {
    contentType: string;
    text: string;
}

/** The proxy error code when the editor frame loaded a JSON error, else null. */
export function editorFrameErrorCode(doc: EditorFrameDocument): string | null {
    if (!doc.contentType.includes('json')) return null;
    try {
        return errorCodeOf(JSON.parse(doc.text));
    } catch {
        return null;
    }
}

/** The `code` field of a JSON error body, or null for any other body. */
export function errorCodeOf(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const code = (body as {code?: unknown}).code;
    return typeof code === 'string' && code ? code : null;
}

/** A problem the status check already proves, or null when it looks fine. */
export function accessStateForStatus(
    status: AutomationStatusResult
): NodeRedProblemState | null {
    if (!status.enabled) return 'misconfigured';
    if (!status.reachable) return 'down';
    return null;
}

/** A permission refusal the server marked as the Node-RED org lock. */
export function isWrongOrganizationError(err: unknown): boolean {
    return (
        domainErrorKind(err) === 'PermissionDenied' &&
        domainErrorReason(err) === WRONG_ORGANIZATION_CODE
    );
}

/** A sentence for a failed automation RPC. */
export function automationErrorText(err: unknown, fallback: string): string {
    if (isWrongOrganizationError(err)) {
        return `${NODE_RED_ACCESS_MESSAGES['wrong-org'].title}.`;
    }
    return formatRpcError(err, fallback);
}
