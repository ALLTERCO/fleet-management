// Open editor WebSockets by user and session. A socket is authorized once, at
// upgrade, so ending a session or revoking a user must also close its sockets.

export interface EditorTunnel {
    destroy(): void;
}

export interface EditorTunnelOwner {
    userId: string;
    /** The editor session id the socket was opened with. */
    sessionId: string;
}

interface TrackedTunnel {
    sessionId: string;
    tunnel: EditorTunnel;
}

const openTunnels = new Map<string, Set<TrackedTunnel>>();

/** Remembers an open editor socket; call the returned function when it ends. */
export function trackEditorTunnel(
    owner: EditorTunnelOwner,
    tunnel: EditorTunnel
): () => void {
    const tracked: TrackedTunnel = {sessionId: owner.sessionId, tunnel};
    const tunnels = openTunnels.get(owner.userId) ?? new Set<TrackedTunnel>();
    tunnels.add(tracked);
    openTunnels.set(owner.userId, tunnels);
    return () => forgetEditorTunnel(owner.userId, tracked);
}

function forgetEditorTunnel(userId: string, tracked: TrackedTunnel): void {
    const tunnels = openTunnels.get(userId);
    tunnels?.delete(tracked);
    if (tunnels?.size === 0) openTunnels.delete(userId);
}

/** Closes every editor socket of the user on this instance. */
export function closeEditorTunnelsForUser(userId: string): number {
    const tunnels = [...(openTunnels.get(userId) ?? [])];
    openTunnels.delete(userId);
    for (const {tunnel} of tunnels) tunnel.destroy();
    return tunnels.length;
}

/** Closes the editor sockets opened with one session on this instance. */
export function closeEditorTunnelsForSession(sessionId: string): number {
    let closed = 0;
    for (const [userId, tunnels] of openTunnels) {
        for (const tracked of tunnels) {
            if (tracked.sessionId !== sessionId) continue;
            forgetEditorTunnel(userId, tracked);
            tracked.tunnel.destroy();
            closed += 1;
        }
    }
    return closed;
}

/** The session ids that still have an open editor socket here. */
export function openEditorTunnelSessions(): string[] {
    const ids = new Set<string>();
    for (const tunnels of openTunnels.values()) {
        for (const {sessionId} of tunnels) ids.add(sessionId);
    }
    return [...ids];
}
