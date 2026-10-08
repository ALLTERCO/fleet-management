// The Node-RED editor session endpoint. Plain fetch, not RPC: the reply sets
// or clears the httpOnly editor cookie under /node-red.

import {NODE_RED_SESSION_URL} from '@/constants';
import {errorCodeOf, type SessionReply} from '@/helpers/nodeRedAccess';

async function replyCode(response: Response): Promise<string | null> {
    if (response.ok) return null;
    const body: unknown = await response.json().catch(() => null);
    return errorCodeOf(body);
}

/** Opens or refreshes the editor session; null when the server was not reached. */
export async function postNodeRedSession(
    token: string
): Promise<SessionReply | null> {
    try {
        const response = await fetch(NODE_RED_SESSION_URL, {
            method: 'POST',
            headers: {authorization: `Bearer ${token}`},
            credentials: 'include'
        });
        return {status: response.status, code: await replyCode(response)};
    } catch (err) {
        console.warn('[node-red] session request failed', err);
        return null;
    }
}

/** Ends the editor session; with a token, every session of the user. */
export async function deleteNodeRedSession(
    token: string | null
): Promise<void> {
    try {
        await fetch(NODE_RED_SESSION_URL, {
            method: 'DELETE',
            headers: token ? {authorization: `Bearer ${token}`} : {},
            credentials: 'include'
        });
    } catch (err) {
        // Logout goes on; the session still ends at its idle timeout.
        console.warn('[node-red] session end failed', err);
    }
}
