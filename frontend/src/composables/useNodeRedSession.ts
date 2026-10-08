import {type Ref, ref} from 'vue';
import {getAutomationStatus} from '@/api/automationRpc';
import {postNodeRedSession} from '@/api/nodeRedSession';
import {
    accessStateForCode,
    accessStateForSessionReply,
    accessStateForStatus,
    isUncheckedSessionReply,
    type NodeRedAccessState,
    type NodeRedProblemState
} from '@/helpers/nodeRedAccess';
import {getAccessToken} from '@/tools/http';

// The editor session idles out server-side; a visible editor keeps it alive.
// One refresh a minute, like Home Assistant's ingress panel.
export const NODE_RED_KEEPALIVE_MS = 60_000;

export interface NodeRedSession {
    state: Ref<NodeRedAccessState>;
    open: () => Promise<void>;
    refresh: () => Promise<void>;
    startKeepAlive: () => void;
    stopKeepAlive: () => void;
    reportEditorError: (code: string) => void;
}

/** Opens the Node-RED editor session, keeps it alive, and says why when it cannot. */
export function useNodeRedSession(): NodeRedSession {
    const state = ref<NodeRedAccessState>('loading');
    let timer: ReturnType<typeof setInterval> | null = null;

    async function open(): Promise<void> {
        state.value = 'loading';
        const token = await currentToken();
        if (!token) {
            state.value = 'no-token';
            return;
        }
        state.value = (await problemFromStatus()) ?? (await openSession(token));
    }

    // A refusal replaces the editor with its reason and stops the keepalive;
    // a refresh that never got an answer about the user leaves it as is.
    async function refresh(): Promise<void> {
        const token = await currentToken();
        if (!token) {
            state.value = 'no-token';
            return;
        }
        const reply = await postNodeRedSession(token);
        if (!reply || isUncheckedSessionReply(reply)) return;
        state.value = accessStateForSessionReply(reply);
    }

    // Only a working editor needs keeping alive; a problem waits for a retry.
    function refreshWhenVisible(): void {
        if (document.visibilityState !== 'visible') return;
        if (state.value === 'ready') void refresh();
    }

    function startKeepAlive(): void {
        stopKeepAlive();
        timer = setInterval(refreshWhenVisible, NODE_RED_KEEPALIVE_MS);
        document.addEventListener('visibilitychange', refreshWhenVisible);
    }

    function stopKeepAlive(): void {
        if (timer !== null) clearInterval(timer);
        timer = null;
        document.removeEventListener('visibilitychange', refreshWhenVisible);
    }

    function reportEditorError(code: string): void {
        const problem = accessStateForCode(code);
        if (problem) state.value = problem;
    }

    return {
        state,
        open,
        refresh,
        startKeepAlive,
        stopKeepAlive,
        reportEditorError
    };
}

function currentToken(): Promise<string | null> {
    return getAccessToken().catch(() => null);
}

// A refused or failing GetStatus must not block the editor; the session
// reply below carries the exact reason.
async function problemFromStatus(): Promise<NodeRedProblemState | null> {
    try {
        return accessStateForStatus(await getAutomationStatus());
    } catch (err) {
        console.warn('[node-red] status check failed', err);
        return null;
    }
}

async function openSession(token: string): Promise<NodeRedAccessState> {
    const reply = await postNodeRedSession(token);
    return reply ? accessStateForSessionReply(reply) : 'down';
}
