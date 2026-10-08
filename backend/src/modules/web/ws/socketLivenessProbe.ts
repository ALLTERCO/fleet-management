// Tells a live socket from a half-open one: a dead peer never answers a ping.

const WS_OPEN = 1;

export interface PingableSocket {
    readonly readyState: number;
    ping(): void;
    once(event: 'pong', listener: () => void): unknown;
    off(event: 'pong', listener: () => void): unknown;
}

export function probeSocketAlive(
    socket: PingableSocket,
    timeoutMs: number
): Promise<boolean> {
    if (socket.readyState !== WS_OPEN) return Promise.resolve(false);
    return new Promise((resolve) => {
        const onPong = () => finish(true);
        const timer = setTimeout(() => finish(false), timeoutMs);
        function finish(alive: boolean): void {
            clearTimeout(timer);
            socket.off('pong', onPong);
            resolve(alive);
        }
        socket.once('pong', onPong);
        if (!sendPing(socket)) finish(false);
    });
}

function sendPing(socket: PingableSocket): boolean {
    try {
        socket.ping();
        return true;
    } catch {
        // A socket that cannot even ping is not a live peer.
        return false;
    }
}
