/**
 * Per-device RPC Transport Bridge
 *
 * Creates individual HTTP+WS servers on ports 8100-8104 that bridge
 * RPC calls between the browser and a Shelly device through Fleet Manager's
 * existing outbound WebSocket transport.
 *
 * This is a pure transport proxy — it does NOT serve device GUI content.
 * The device GUI is served separately (via the path-based proxy in device-proxy.ts).
 * The firmware's `shelly_addr` URL parameter points here for RPC calls.
 *
 * Follows the proxy-transport.ts pattern from the device firmware team:
 *   Browser (iframe with Shelly GUI)
 *     ↕ HTTP POST /rpc  or  WebSocket /rpc
 *   This bridge (port 8100-8104)
 *     ↕ device.sendRPC() via FM's outbound WebSocket
 *   Shelly Device
 */

import * as http from 'node:http';
import * as net from 'node:net';
import log4js from 'log4js';
import WebSocket from 'ws';
import * as DeviceCollector from '../DeviceCollector';
import * as Observability from '../Observability';

const logger = log4js.getLogger('device-gui-proxy');

interface DeviceProxy {
    server: http.Server;
    wsServer: WebSocket.Server;
    port: number;
    shellyID: string;
    lastActivity: number;
}

const activeProxies = new Map<string, DeviceProxy>();

const PORT_RANGE_START = 8100;
const PORT_RANGE_END = 8104;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Cleanup idle proxies every minute
setInterval(() => {
    const now = Date.now();
    for (const [shellyID, proxy] of activeProxies) {
        if (now - proxy.lastActivity > IDLE_TIMEOUT) {
            logger.info(
                'Stopping idle proxy for %s on port %d',
                shellyID,
                proxy.port
            );
            stopProxy(shellyID);
        }
    }
}, 60_000);

/**
 * Check if a port is available for binding.
 */
function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port, '0.0.0.0');
    });
}

/**
 * Find an available port in the configured range.
 */
async function findAvailablePort(): Promise<number> {
    const usedPorts = new Set([...activeProxies.values()].map((p) => p.port));

    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
        if (usedPorts.has(port)) continue;
        if (await isPortAvailable(port)) {
            return port;
        }
    }

    throw new Error(
        `No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`
    );
}

// ============================================================================
// RPC HANDLING (via FM device transport — works for remote devices)
// ============================================================================

/**
 * Handle an HTTP POST to /rpc — JSON-RPC request proxied through FM.
 */
function handleRpcPost(
    shellyID: string,
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse
) {
    let body = '';
    clientReq.on('data', (chunk: Buffer) => {
        body += chunk.toString();
    });
    clientReq.on('end', async () => {
        Observability.incrementCounter('device_proxy_rpc_calls');
        const device = DeviceCollector.getDevice(shellyID);
        if (!device || !device.online) {
            Observability.incrementCounter('device_proxy_rpc_errors');
            clientRes.writeHead(503, {'Content-Type': 'application/json'});
            clientRes.end(
                JSON.stringify({
                    id: 0,
                    error: {code: -32603, message: 'Device offline'}
                })
            );
            return;
        }

        let msg: any;
        try {
            msg = JSON.parse(body);
        } catch {
            clientRes.writeHead(400, {'Content-Type': 'application/json'});
            clientRes.end(
                JSON.stringify({
                    id: 0,
                    error: {code: -32700, message: 'Parse error'}
                })
            );
            return;
        }

        try {
            const result = await device.sendRPC(msg.method, msg.params || {});
            clientRes.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            clientRes.end(
                JSON.stringify({
                    id: msg.id ?? 0,
                    src: shellyID,
                    dst: msg.src || 'user',
                    result
                })
            );
        } catch (error: any) {
            clientRes.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            clientRes.end(
                JSON.stringify({
                    id: msg.id ?? 0,
                    src: shellyID,
                    dst: msg.src || 'user',
                    error: {
                        code: error.code || -32603,
                        message: error.message || 'Internal error'
                    }
                })
            );
        }
    });
}

/**
 * Handle an HTTP GET to /rpc/MethodName?params — Shelly GET-style RPC.
 */
function handleRpcGet(
    shellyID: string,
    method: string,
    query: URLSearchParams,
    clientRes: http.ServerResponse
) {
    const device = DeviceCollector.getDevice(shellyID);
    if (!device || !device.online) {
        clientRes.writeHead(503, {'Content-Type': 'application/json'});
        clientRes.end(JSON.stringify({error: 'Device offline'}));
        return;
    }

    const params: Record<string, any> = {};
    for (const [key, value] of query) {
        if (key === 'token') continue;
        if (value === 'true') params[key] = true;
        else if (value === 'false') params[key] = false;
        else if (!Number.isNaN(Number(value)) && value !== '')
            params[key] = Number(value);
        else params[key] = value;
    }

    device
        .sendRPC(method, params)
        .then((result: any) => {
            clientRes.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            clientRes.end(JSON.stringify(result));
        })
        .catch((error: any) => {
            clientRes.writeHead(500, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            clientRes.end(
                JSON.stringify({
                    error: error.message || 'Internal error',
                    code: error.code
                })
            );
        });
}

/**
 * Handle WebSocket upgrade on /rpc — bridge browser WS ↔ device transport.
 * Follows the proxy-transport.ts pattern from the device firmware team.
 */
function handleRpcWsUpgrade(
    shellyID: string,
    wsServer: WebSocket.Server,
    request: http.IncomingMessage,
    socket: net.Socket,
    head: Buffer
) {
    wsServer.handleUpgrade(request, socket, head, (ws) => {
        let device = DeviceCollector.getDevice(shellyID);
        if (!device) {
            ws.close(4004, 'Device not found');
            return;
        }

        // ====== Reconnection state ======
        const GRACE_PERIOD_MS = 15_000;
        const POLL_INTERVAL_MS = 1_000;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectPollInterval: ReturnType<typeof setInterval> | null = null;
        let messageQueue: string[] = [];
        let isReconnecting = false;

        logger.info(
            'WS RPC bridge opened for %s (online: %s)',
            shellyID,
            device.online
        );

        // ====== Transport listener functions ======

        const onDeviceMessage = (msg: any) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (msg.method) {
                try {
                    ws.send(JSON.stringify(msg));
                } catch (e) {
                    logger.error(
                        'WS bridge: error forwarding notification for %s: %s',
                        shellyID,
                        e
                    );
                }
            }
        };

        const onTransportClose = () => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (isReconnecting) return;

            logger.info(
                'WS bridge [%s]: transport closed, starting %ds grace period',
                shellyID,
                GRACE_PERIOD_MS / 1000
            );

            isReconnecting = true;
            detachTransport();

            reconnectPollInterval = setInterval(() => {
                const newDevice = DeviceCollector.getDevice(shellyID);
                if (newDevice?.online && newDevice.transport) {
                    logger.info('WS bridge [%s]: device reconnected', shellyID);
                    clearReconnectTimers();
                    isReconnecting = false;
                    device = newDevice;
                    attachTransport(device);
                    flushMessageQueue();
                }
            }, POLL_INTERVAL_MS);

            reconnectTimer = setTimeout(() => {
                if (isReconnecting && ws.readyState === WebSocket.OPEN) {
                    logger.info(
                        'WS bridge [%s]: grace period expired',
                        shellyID
                    );
                    clearReconnectTimers();
                    isReconnecting = false;
                    ws.close(4005, 'Device disconnected');
                }
            }, GRACE_PERIOD_MS);
        };

        // ====== Attach/detach helpers ======

        function attachTransport(dev: NonNullable<typeof device>) {
            if (!dev.transport) return;
            dev.transport.eventemitter.on('message', onDeviceMessage);
            dev.transport.eventemitter.on('close', onTransportClose);
        }

        function detachTransport() {
            device?.transport?.eventemitter.off('message', onDeviceMessage);
            device?.transport?.eventemitter.off('close', onTransportClose);
        }

        function clearReconnectTimers() {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (reconnectPollInterval) {
                clearInterval(reconnectPollInterval);
                reconnectPollInterval = null;
            }
        }

        function flushMessageQueue() {
            const queued = messageQueue;
            messageQueue = [];
            if (queued.length > 0) {
                logger.info(
                    'WS bridge [%s]: flushing %d queued messages',
                    shellyID,
                    queued.length
                );
            }
            for (const raw of queued) {
                handleBrowserMessage(raw);
            }
        }

        // ====== Browser message handler ======

        async function handleBrowserMessage(rawData: string) {
            let msg: any;
            try {
                msg = JSON.parse(rawData);
            } catch {
                return;
            }

            if (!msg.method) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(
                        JSON.stringify({
                            id: msg.id,
                            error: {
                                code: -32600,
                                message: 'Invalid request: method required'
                            }
                        })
                    );
                }
                return;
            }

            if (isReconnecting) {
                messageQueue.push(rawData);
                return;
            }

            const currentDevice = DeviceCollector.getDevice(shellyID);
            if (!currentDevice?.online || !currentDevice.transport) {
                messageQueue.push(rawData);
                if (!isReconnecting) {
                    onTransportClose();
                }
                return;
            }

            if (currentDevice !== device) {
                detachTransport();
                device = currentDevice;
                attachTransport(device);
            }

            try {
                const result = await device.sendRPC(msg.method, msg.params);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(
                        JSON.stringify({
                            id: msg.id,
                            src: shellyID,
                            dst: msg.src,
                            result
                        })
                    );
                }
            } catch (error: any) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(
                        JSON.stringify({
                            id: msg.id,
                            src: shellyID,
                            dst: msg.src,
                            error: {
                                code: error.code || -32603,
                                message: error.message || 'Internal error'
                            }
                        })
                    );
                }
            }
        }

        // ====== Initial transport attach ======

        if (device.online && device.transport) {
            attachTransport(device);
        } else {
            logger.info(
                'WS bridge [%s]: device offline at connect, starting grace period',
                shellyID
            );
            isReconnecting = true;

            reconnectPollInterval = setInterval(() => {
                const newDevice = DeviceCollector.getDevice(shellyID);
                if (newDevice?.online && newDevice.transport) {
                    logger.info('WS bridge [%s]: device came online', shellyID);
                    clearReconnectTimers();
                    isReconnecting = false;
                    device = newDevice;
                    attachTransport(device);
                    flushMessageQueue();
                }
            }, POLL_INTERVAL_MS);

            reconnectTimer = setTimeout(() => {
                if (isReconnecting && ws.readyState === WebSocket.OPEN) {
                    logger.info(
                        'WS bridge [%s]: initial grace period expired',
                        shellyID
                    );
                    clearReconnectTimers();
                    isReconnecting = false;
                    ws.close(4005, 'Device offline');
                }
            }, GRACE_PERIOD_MS);
        }

        // ====== Wire up browser events ======

        ws.on('message', (rawData: WebSocket.RawData) => {
            handleBrowserMessage(rawData.toString());
        });

        ws.on('close', () => {
            logger.info('WS RPC bridge closed for %s', shellyID);
            detachTransport();
            clearReconnectTimers();
            messageQueue = [];
        });

        ws.on('error', (err) => {
            logger.error(
                'WS RPC bridge error for %s: %s',
                shellyID,
                err.message
            );
        });
    });
}

// ============================================================================
// PROXY LIFECYCLE
// ============================================================================

/**
 * Start an RPC transport bridge for a device.
 *
 * The bridge handles ONLY RPC traffic:
 *  - POST /rpc        → JSON-RPC via FM transport
 *  - GET /rpc/Method   → Shelly GET-style RPC via FM transport
 *  - WebSocket /rpc    → bidirectional WS bridge via FM transport
 */
export async function startProxy(shellyID: string): Promise<{port: number}> {
    // Reuse existing proxy
    const existing = activeProxies.get(shellyID);
    if (existing) {
        existing.lastActivity = Date.now();
        logger.debug(
            'Reusing proxy for %s on port %d',
            shellyID,
            existing.port
        );
        return {port: existing.port};
    }

    const port = await findAvailablePort();

    // Per-device WebSocket server for /rpc bridging (noServer mode)
    const wsServer = new WebSocket.Server({noServer: true});

    const server = http.createServer((clientReq, clientRes) => {
        const proxy = activeProxies.get(shellyID);
        if (proxy) proxy.lastActivity = Date.now();

        const url = new URL(clientReq.url || '/', 'http://localhost');

        // CORS preflight for RPC endpoints
        if (clientReq.method === 'OPTIONS') {
            clientRes.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400'
            });
            clientRes.end();
            return;
        }

        // /rpc POST — JSON-RPC via FM transport
        if (url.pathname === '/rpc' && clientReq.method === 'POST') {
            handleRpcPost(shellyID, clientReq, clientRes);
            return;
        }

        // /rpc/MethodName GET — Shelly GET-style RPC via FM transport
        const rpcGetMatch = url.pathname.match(/^\/rpc\/(.+)$/);
        if (rpcGetMatch && clientReq.method === 'GET') {
            handleRpcGet(shellyID, rpcGetMatch[1], url.searchParams, clientRes);
            return;
        }

        // This bridge handles ONLY RPC — no HTTP content serving
        clientRes.writeHead(404, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        clientRes.end(
            JSON.stringify({
                error: 'Only /rpc endpoints are supported on this bridge'
            })
        );
    });

    // WebSocket upgrades — only /rpc
    server.on('upgrade', (clientReq, clientSocket, head) => {
        const proxy = activeProxies.get(shellyID);
        if (proxy) proxy.lastActivity = Date.now();

        const url = new URL(clientReq.url || '/', 'http://localhost');

        if (url.pathname === '/rpc') {
            handleRpcWsUpgrade(
                shellyID,
                wsServer,
                clientReq,
                clientSocket as net.Socket,
                head
            );
            return;
        }

        // Reject non-/rpc WebSocket upgrades
        (clientSocket as net.Socket).destroy();
    });

    return new Promise((resolve, reject) => {
        server.listen(port, '0.0.0.0', () => {
            activeProxies.set(shellyID, {
                server,
                wsServer,
                port,
                shellyID,
                lastActivity: Date.now()
            });
            logger.info('Started RPC bridge for %s on port %d', shellyID, port);
            resolve({port});
        });

        server.on('error', (err) => {
            logger.error(
                'Failed to start RPC bridge for %s on port %d: %s',
                shellyID,
                port,
                err.message
            );
            reject(err);
        });
    });
}

/**
 * Stop the proxy server for a device.
 */
export function stopProxy(shellyID: string): void {
    const proxy = activeProxies.get(shellyID);
    if (!proxy) return;

    proxy.wsServer.close();
    proxy.server.close();
    activeProxies.delete(shellyID);
    logger.info('Stopped RPC bridge for %s on port %d', shellyID, proxy.port);
}

/**
 * Get proxy info for a device, if running.
 */
export function getProxy(shellyID: string): {port: number} | null {
    const proxy = activeProxies.get(shellyID);
    if (!proxy) return null;
    return {port: proxy.port};
}

/**
 * Stop all active proxies (for shutdown).
 */
export function stopAllProxies(): void {
    for (const [shellyID] of activeProxies) {
        stopProxy(shellyID);
    }
}

Observability.registerModule('deviceProxy', () => ({
    activeProxies: activeProxies.size,
    portsUsed: activeProxies.size,
    portsTotal: PORT_RANGE_END - PORT_RANGE_START + 1
}));
