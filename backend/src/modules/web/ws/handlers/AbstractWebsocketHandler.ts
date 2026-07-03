import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {getLogger} from 'log4js';
import WebSocket from 'ws';
import {tuning} from '../../../../config/tuning';
import * as Observability from '../../../Observability';
import {AdmissionGate} from '../admissionGate';
import {buildPerMessageDeflate} from '../perMessageDeflate';
import {applyTcpKeepalive, extractTcpSocket} from '../tcpKeepalive';

const logger = getLogger('ws-server');

let wsMaxBufferedKB = 0;

// 5 MB cap on inbound frames — prevents OOM from oversized payloads.
// Every subclass should inherit this; merging into the constructor
// options means callers that pass {host, port, ...} keep the cap.
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

type Options = ConstructorParameters<typeof WebSocket.Server>[0];
export type WebSocketExt = WebSocket.WebSocket & {
    isAlive: boolean;
    /** Consecutive heartbeat cycles where pong was not received */
    missedPongs?: number;
    /** Attached by WebSocketTransport for pending-RPC awareness */
    __rpcTransport?: {pendingRpcCount: number};
};

export interface HeartbeatOptions {
    missedPongsMax: number;
}

export function processHeartbeatClient(
    ws: WebSocketExt,
    options: HeartbeatOptions
): void {
    if ('readyState' in ws && ws.readyState !== ws.OPEN) return;
    try {
        if (ws.isAlive === false) {
            const missed = (ws.missedPongs ?? 0) + 1;
            ws.missedPongs = missed;
            const pending = ws.__rpcTransport?.pendingRpcCount ?? 0;
            const limit = options.missedPongsMax + (pending > 0 ? 1 : 0);
            if (missed < limit) {
                if (pending > 0) {
                    logger.warn(
                        'Deferring close: %d pending RPCs (missed %d cycles)',
                        pending,
                        missed
                    );
                }
                ws.ping();
                return;
            }
            logger.error(
                'Closing socket bc of ping/pong timeout (missed %d cycles, %d pending RPCs)',
                missed,
                pending
            );
            ws.terminate();
            return;
        }
        ws.missedPongs = 0;
        ws.isAlive = false;
        ws.ping();
    } catch (err) {
        logger.warn(
            'Heartbeat skipped socket after ping/terminate failure: %s',
            err instanceof Error ? err.message : String(err)
        );
    }
}

export default abstract class AbstractWebsocketHandler {
    protected _server: WebSocket.Server;
    #interval: NodeJS.Timeout;
    readonly #heartbeatMs: number;
    readonly #admissionGate: AdmissionGate;

    constructor(options: Options = {noServer: true}, heartbeatMs?: number) {
        const opts = {
            maxPayload: MAX_PAYLOAD_BYTES,
            perMessageDeflate: buildPerMessageDeflate(tuning.ws),
            ...(options ?? {})
        };
        this._server = new WebSocket.Server(opts);
        this.#heartbeatMs = heartbeatMs ?? tuning.ws.heartbeatMs;
        this.#admissionGate = new AdmissionGate({
            label: this.constructor.name,
            capPerSec: tuning.ws.admissionMaxPerSec
        });
        logger.info(
            `starting a server on port ${opts.port || '<default-port>'}`
        );
        // Fatal-exit on bind failure (EADDRINUSE, EACCES). Without this
        // handler Node escalates to 'uncaughtException' — which logs and
        // continues, leaving a half-booted zombie holding the other ports.
        this._server.on('error', (err) => {
            logger.fatal(
                'ws-server error on port %s: %s',
                opts.port ?? '<default-port>',
                err instanceof Error ? err.message : String(err)
            );
            process.exit(1);
        });
        this.#interval = this.#createHeartbeat();
        this._server.on(
            'connection',
            (ws: WebSocketExt, request: IncomingMessage) => {
                ws.isAlive = true;
                this.#armTcpKeepalive(ws);
                this._handleWebsocket(ws, request);
                ws.on('pong', () => {
                    ws.isAlive = true;
                    ws.missedPongs = 0;
                });
            }
        );
        this._server.on('close', () => {
            clearInterval(this.#interval);
        });
    }

    public handleUpgrade(
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ) {
        if (!this.#admissionGate.tryAdmit()) {
            socket.destroy();
            return;
        }
        this._server.handleUpgrade(request, socket, head, (ws) => {
            this._server.emit('connection', ws, request);
        });
    }

    /**
     * Heartbeat listener
     * @tutorial https://github.com/websockets/ws#how-to-detect-and-close-broken-connections
     */
    #createHeartbeat() {
        const chunkSize = tuning.ws.heartbeatChunkSize;
        // unref so the heartbeat does not hold the event loop alive if the
        // server tears down without emitting 'close' (e.g. WS lib error after
        // bind succeeded — main path is the 'error' handler above, but the
        // interval should not pin the process either way).
        const interval = setInterval(() => {
            const clients = Array.from(
                this._server.clients as Set<WebSocketExt>
            );
            let offset = 0;
            let maxBuf = 0;

            const processChunk = () => {
                const end = Math.min(offset + chunkSize, clients.length);
                for (let i = offset; i < end; i++) {
                    const ws = clients[i];
                    if (ws.bufferedAmount > maxBuf) maxBuf = ws.bufferedAmount;
                    processHeartbeatClient(ws, {
                        missedPongsMax: tuning.ws.heartbeatMissedPongsMax
                    });
                }
                offset = end;
                if (offset < clients.length) {
                    setImmediate(processChunk);
                } else {
                    wsMaxBufferedKB = Math.round(maxBuf / 1024);
                    Observability.setGauge(
                        'ws_max_buffered_kb',
                        wsMaxBufferedKB
                    );
                }
            };

            processChunk();
        }, this.#heartbeatMs);
        interval.unref();
        return interval;
    }

    #armTcpKeepalive(ws: WebSocketExt): void {
        if (tuning.http.tcpKeepaliveDelayMs <= 0) return;
        const sock = extractTcpSocket(ws as unknown as {_socket?: any});
        if (sock) applyTcpKeepalive(sock, tuning.http.tcpKeepaliveDelayMs);
    }

    protected abstract _handleWebsocket(
        ws: WebSocketExt,
        request: IncomingMessage
    ): void;

    /** Close the underlying ws.Server so its listening socket releases.
     *  Must be awaited during graceful shutdown to free the bound port. */
    public close(): Promise<void> {
        return new Promise((resolve) => {
            this._server.close(() => resolve());
        });
    }
}
