import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {getLogger} from 'log4js';
import WebSocket, {type RawData} from 'ws';
import {tuning} from '../../../../config/tuning';
import * as Observability from '../../../Observability';
import {
    reportContainedFault,
    reportHandledPeerError
} from '../../../util/faultGuard';
import {AdmissionGate} from '../admissionGate';
import {buildPerMessageDeflate} from '../perMessageDeflate';
import {applyTcpKeepalive, extractTcpSocket} from '../tcpKeepalive';

const logger = getLogger('ws-server');

let wsMaxBufferedKB = 0;
const activeConnectionsByTraffic = new Map<string, number>();
const MESSAGE_FORMATS = ['text', 'binary'] as const;
const MESSAGE_SIZE_BUCKETS = [
    'le_1k',
    'le_16k',
    'le_256k',
    'le_1m',
    'gt_1m'
] as const;

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

function trafficLabel(handlerName: string): 'client' | 'device' | 'unknown' {
    if (handlerName === 'ClientWebsocketHandler') return 'client';
    if (handlerName === 'ShellyWebsocketHandler') return 'device';
    return 'unknown';
}

function rawDataBytes(data: RawData): number {
    if (Array.isArray(data)) {
        return data.reduce((total, chunk) => total + chunk.byteLength, 0);
    }
    return data.byteLength;
}

function messageSizeBucketIndex(bytes: number): number {
    if (bytes <= 1024) return 0;
    if (bytes <= 16 * 1024) return 1;
    if (bytes <= 256 * 1024) return 2;
    if (bytes <= 1024 * 1024) return 3;
    return 4;
}

function closeCodeLabel(code: number): string {
    if (code >= 3000 && code <= 4999) return 'application';
    if (code >= 1000 && code <= 1015) return String(code);
    return 'other';
}

function changeActiveConnections(traffic: string, delta: 1 | -1): void {
    const count = Math.max(
        0,
        (activeConnectionsByTraffic.get(traffic) ?? 0) + delta
    );
    activeConnectionsByTraffic.set(traffic, count);
    Observability.setLabeledGauge('ws_active_connections', {traffic}, count);
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
    readonly #connections = new Set<WebSocketExt>();
    readonly #wireStates = new Map<
        WebSocketExt,
        {
            traffic: string;
            negotiated: string;
            tcp: ReturnType<typeof extractTcpSocket>;
            lastRead: number;
            lastWritten: number;
            totalRead: number;
            totalWritten: number;
        }
    >();
    readonly #messageBytes = new Float64Array(4);
    readonly #messageCounts = new Float64Array(20);

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
        // Only a real bind failure is unrecoverable. Any other ws-server error
        // is a runtime fault and must be contained, not exit the whole instance.
        this._server.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException)?.code;
            if (code === 'EADDRINUSE' || code === 'EACCES') {
                logger.fatal(
                    'ws-server bind error on port %s: %s',
                    opts.port ?? '<default-port>',
                    err instanceof Error ? err.message : String(err)
                );
                process.exit(1);
            }
            reportContainedFault('ws-server', err);
        });
        this.#interval = this.#createHeartbeat();
        this._server.on(
            'connection',
            (ws: WebSocketExt, request: IncomingMessage) => {
                ws.isAlive = true;
                const traffic = trafficLabel(this.constructor.name);
                const compression =
                    typeof ws.extensions === 'string' &&
                    ws.extensions.includes('permessage-deflate')
                        ? 'yes'
                        : 'no';
                const compressionOffered = String(
                    request.headers?.['sec-websocket-extensions'] ?? ''
                ).includes('permessage-deflate')
                    ? 'yes'
                    : 'no';
                const tcp = extractTcpSocket(ws as unknown as {_socket?: any});
                const startedAt = performance.now();
                const bytesReadAtOpen = tcp?.bytesRead ?? 0;
                const bytesWrittenAtOpen = tcp?.bytesWritten ?? 0;
                this.#connections.add(ws);
                changeActiveConnections(traffic, 1);
                this.#wireStates.set(ws, {
                    traffic,
                    negotiated: compression,
                    tcp,
                    lastRead: bytesReadAtOpen,
                    lastWritten: bytesWrittenAtOpen,
                    totalRead: 0,
                    totalWritten: 0
                });
                Observability.incrementLabeledCounter(
                    'ws_connection_events_total',
                    {traffic, outcome: 'opened', compression}
                );
                Observability.incrementLabeledCounter('ws_compression_total', {
                    traffic,
                    offered: compressionOffered,
                    negotiated: compression
                });
                if (logger.isDebugEnabled()) {
                    logger.debug(
                        JSON.stringify({
                            event: 'websocket',
                            stage: 'connected',
                            traffic,
                            compressionOffered,
                            compression,
                            remoteIp: request.socket?.remoteAddress
                        })
                    );
                }
                // A malformed frame or a peer reset makes ws emit 'error' on
                // this socket; with no listener Node rethrows it as
                // uncaughtException and the whole instance exits. This is the
                // outside world misbehaving, not our bug — handle it quietly. One
                // listener here covers every subclass.
                ws.on('error', (err) => {
                    Observability.incrementLabeledCounter(
                        'ws_connection_events_total',
                        {traffic, outcome: 'error', compression}
                    );
                    reportHandledPeerError('ws-socket', err);
                });
                ws.on('message', (data, isBinary) => {
                    if (Observability.getLevel() < 2) return;
                    const bytes = rawDataBytes(data);
                    const negotiatedIndex = compression === 'yes' ? 1 : 0;
                    const formatIndex = isBinary ? 1 : 0;
                    this.#messageBytes[negotiatedIndex * 2 + formatIndex] +=
                        bytes;
                    this.#messageCounts[
                        negotiatedIndex * 10 +
                            formatIndex * 5 +
                            messageSizeBucketIndex(bytes)
                    ]++;
                });
                ws.once('close', (code) => {
                    if (this.#connections.delete(ws)) {
                        changeActiveConnections(traffic, -1);
                    }
                    Observability.incrementLabeledCounter(
                        'ws_connection_events_total',
                        {traffic, outcome: 'closed', compression}
                    );
                    Observability.incrementLabeledCounter('ws_closes_total', {
                        traffic,
                        negotiated: compression,
                        code: closeCodeLabel(code)
                    });
                    const {received, sent} = this.#flushWireMetrics(ws);
                    this.#wireStates.delete(ws);
                    const durationMs = performance.now() - startedAt;
                    Observability.recordRpcTiming(
                        `websocket_${traffic}_lifetime`,
                        durationMs
                    );
                    if (logger.isDebugEnabled()) {
                        logger.debug(
                            JSON.stringify({
                                event: 'websocket',
                                stage: 'closed',
                                traffic,
                                compression,
                                code,
                                durationMs: Math.round(durationMs),
                                receivedBytes: received,
                                sentBytes: sent
                            })
                        );
                    }
                });
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
            this._flushTrafficMetrics();
            const traffic = trafficLabel(this.constructor.name);
            for (const ws of this.#connections) {
                changeActiveConnections(traffic, -1);
                this.#wireStates.delete(ws);
            }
            this.#connections.clear();
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

            // processHeartbeatClient guards itself; contain the scaffold too so
            // a throw here (or in a setImmediate re-entry) can't crash.
            const processChunk = () => {
                try {
                    const end = Math.min(offset + chunkSize, clients.length);
                    for (let i = offset; i < end; i++) {
                        const ws = clients[i];
                        if (ws.bufferedAmount > maxBuf)
                            maxBuf = ws.bufferedAmount;
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
                        this._flushTrafficMetrics();
                    }
                } catch (err) {
                    reportContainedFault('ws-heartbeat', err);
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

    #flushWireMetrics(ws?: WebSocketExt): {received: number; sent: number} {
        let received = 0;
        let sent = 0;
        const entries = ws
            ? ([[ws, this.#wireStates.get(ws)]] as const)
            : this.#wireStates.entries();
        for (const [, state] of entries) {
            if (!state) continue;
            const nextRead = state.tcp?.bytesRead ?? state.lastRead;
            const nextWritten = state.tcp?.bytesWritten ?? state.lastWritten;
            const readDelta = Math.max(0, nextRead - state.lastRead);
            const writtenDelta = Math.max(0, nextWritten - state.lastWritten);
            state.lastRead = nextRead;
            state.lastWritten = nextWritten;
            state.totalRead += readDelta;
            state.totalWritten += writtenDelta;
            received += ws ? state.totalRead : readDelta;
            sent += ws ? state.totalWritten : writtenDelta;
            if (readDelta > 0) {
                Observability.incrementLabeledCounter(
                    'ws_wire_bytes_total',
                    {
                        traffic: state.traffic,
                        direction: 'inbound',
                        negotiated: state.negotiated
                    },
                    readDelta
                );
            }
            if (writtenDelta > 0) {
                Observability.incrementLabeledCounter(
                    'ws_wire_bytes_total',
                    {
                        traffic: state.traffic,
                        direction: 'outbound',
                        negotiated: state.negotiated
                    },
                    writtenDelta
                );
            }
        }
        return {received, sent};
    }

    protected _flushTrafficMetrics(): void {
        this.#flushWireMetrics();
        const traffic = trafficLabel(this.constructor.name);
        for (let negotiatedIndex = 0; negotiatedIndex < 2; negotiatedIndex++) {
            const negotiated = negotiatedIndex === 1 ? 'yes' : 'no';
            for (let formatIndex = 0; formatIndex < 2; formatIndex++) {
                const format = MESSAGE_FORMATS[formatIndex];
                const byteIndex = negotiatedIndex * 2 + formatIndex;
                const bytes = this.#messageBytes[byteIndex];
                this.#messageBytes[byteIndex] = 0;
                if (bytes > 0) {
                    Observability.incrementLabeledCounter(
                        'ws_message_bytes_total',
                        {traffic, direction: 'inbound', format, negotiated},
                        bytes
                    );
                }
                for (let sizeIndex = 0; sizeIndex < 5; sizeIndex++) {
                    const countIndex =
                        negotiatedIndex * 10 + formatIndex * 5 + sizeIndex;
                    const count = this.#messageCounts[countIndex];
                    this.#messageCounts[countIndex] = 0;
                    if (count <= 0) continue;
                    Observability.incrementLabeledCounter(
                        'ws_message_size_bucket_total',
                        {
                            traffic,
                            direction: 'inbound',
                            format,
                            size: MESSAGE_SIZE_BUCKETS[sizeIndex],
                            negotiated
                        },
                        count
                    );
                }
            }
        }
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
