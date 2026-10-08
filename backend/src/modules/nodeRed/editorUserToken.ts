// Tells Node-RED who is acting, so its own audit log names the Fleet Manager
// user. deploy/nodered/settings.js verifies the token in adminAuth.tokens.

import {createHmac} from 'node:crypto';
import {tuning} from '../../config/tuning';

/** The header Node-RED's adminAuth.tokenHeader reads. */
export const NODE_RED_USER_HEADER = 'x-fm-node-red-user';

/** The name Fleet Manager's own server-side admin API calls carry. */
export const NODE_RED_SERVER_IDENTITY: NodeRedEditorIdentity = {
    username: 'fleet-manager'
};

// Short on purpose: the proxy signs a fresh token for every request.
const USER_TOKEN_LIFETIME_MS = 5 * 60_000;

export interface NodeRedEditorIdentity {
    username: string;
    displayName?: string;
}

function encodedPayload(
    identity: NodeRedEditorIdentity,
    nowMs: number
): string {
    const payload = {
        u: identity.username,
        ...(identity.displayName ? {n: identity.displayName} : {}),
        exp: nowMs + USER_TOKEN_LIFETIME_MS
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signature(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** A user token for Node-RED, signed with the given proxy secret. */
export function signNodeRedUserToken(
    identity: NodeRedEditorIdentity,
    signing: {secret: string; nowMs?: number}
): string {
    const payload = encodedPayload(identity, signing.nowMs ?? Date.now());
    return `${payload}.${signature(payload, signing.secret)}`;
}

/** The signed user header, or none when no proxy secret is configured. */
export function nodeRedUserHeader(
    identity: NodeRedEditorIdentity,
    nowMs = Date.now()
): Record<string, string> {
    const secret = tuning.nodeRed.proxySecret;
    if (!secret) return {};
    return {
        [NODE_RED_USER_HEADER]: signNodeRedUserToken(identity, {secret, nowMs})
    };
}
