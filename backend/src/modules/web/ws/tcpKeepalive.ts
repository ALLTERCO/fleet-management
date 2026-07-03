// OS-level TCP keepalive on the WS-underlying socket.
import type {Socket} from 'node:net';

export interface TcpKeepaliveTarget {
    setKeepAlive(enable: boolean, initialDelay: number): void;
}

export function applyTcpKeepalive(
    socket: TcpKeepaliveTarget,
    initialDelayMs: number
): void {
    socket.setKeepAlive(true, initialDelayMs);
}

export function extractTcpSocket(ws: {_socket?: Socket}): Socket | undefined {
    return ws._socket;
}
