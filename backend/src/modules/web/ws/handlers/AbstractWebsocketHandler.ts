import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {getLogger} from 'log4js';
import WebSocket from 'ws';
import * as Observability from '../../../Observability';
const logger = getLogger('ws-server');

let wsMaxBufferedKB = 0;

type Options = ConstructorParameters<typeof WebSocket.Server>[0];
export type WebSocketExt = WebSocket.WebSocket & {
    isAlive: boolean;
    /** Consecutive heartbeat cycles where pong was not received */
    missedPongs?: number;
    /** Attached by WebSocketTransport for pending-RPC awareness */
    __rpcTransport?: {pendingRpcCount: number};
};

export default abstract class AbstractWebsocketHandler {
    protected _server: WebSocket.Server;
    #interval: NodeJS.Timeout;

    constructor(
        options: Options = {
            noServer: true
        }
    ) {
        this._server = new WebSocket.Server(options);
        logger.info(
            `starting a server on port ${options.port || '<default-port>'}`
        );
        this.#interval = this.#createHeartbeat();
        this._server.on(
            'connection',
            (ws: WebSocketExt, request: IncomingMessage) => {
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
        this._server.handleUpgrade(request, socket, head, (ws) => {
            this._server.emit('connection', ws, request);
        });
    }

    /**
     * Heartbeat listener
     * @tutorial https://github.com/websockets/ws#how-to-detect-and-close-broken-connections
     */
    #createHeartbeat() {
        const CHUNK_SIZE = 100;
        return setInterval(() => {
            const clients = Array.from(
                this._server.clients as Set<WebSocketExt>
            );
            let offset = 0;
            let maxBuf = 0;

            const processChunk = () => {
                const end = Math.min(offset + CHUNK_SIZE, clients.length);
                for (let i = offset; i < end; i++) {
                    const ws = clients[i];
                    if (ws.bufferedAmount > maxBuf) maxBuf = ws.bufferedAmount;
                    if (ws.isAlive === false) {
                        const missed = (ws.missedPongs ?? 0) + 1;
                        ws.missedPongs = missed;
                        const pending = ws.__rpcTransport?.pendingRpcCount ?? 0;
                        // Grace: if the socket has pending RPCs and only missed one
                        // cycle, give it one more interval before terminating.
                        if (missed <= 1 && pending > 0) {
                            logger.warn(
                                'Deferring close for socket with %d pending RPCs (missed %d cycle)',
                                pending,
                                missed
                            );
                            ws.ping();
                            continue;
                        }
                        logger.error(
                            'Closing socket bc of ping/pong timeout (missed %d cycles, %d pending RPCs)',
                            missed,
                            pending
                        );
                        ws.terminate();
                        ws.emit('close', 'TIMEOUT');
                        continue;
                    }
                    ws.missedPongs = 0;
                    ws.isAlive = false;
                    ws.ping();
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
        }, 30000);
    }

    protected abstract _handleWebsocket(
        ws: WebSocketExt,
        request: IncomingMessage
    ): void;
}
