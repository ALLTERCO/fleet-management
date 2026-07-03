import * as http from 'node:http';
import * as net from 'node:net';
import type {Duplex} from 'node:stream';
import {finished} from 'node:stream';
import type express from 'express';
import {getLogger} from 'log4js';

// Dev only: serve the UI from the Vite dev server (HMR) on the backend's own
// port, so developers use one port and get instant updates. Never registered
// outside DEV_MODE.
const logger = getLogger('vite-dev-proxy');
const VITE_HOST = 'localhost';
const VITE_PORT = 5173;

// Forward a UI/asset request to Vite. Registered after all API routes, so only
// unmatched (frontend) requests reach here.
export function viteDevHttpProxy(
    req: express.Request,
    res: express.Response
): void {
    const upstream = http.request(
        {
            host: VITE_HOST,
            port: VITE_PORT,
            method: req.method,
            path: req.originalUrl,
            headers: req.headers
        },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
        }
    );
    upstream.on('error', (err) => {
        logger.warn('vite http proxy failed: %s', err);
        if (!res.headersSent) {
            res.status(502).end('vite dev server unavailable');
        }
    });
    req.pipe(upstream);
}

// The app's client WS and Vite's HMR WS both land on '/'; they differ by
// subprotocol. This is Vite's.
export function isViteHmrUpgrade(request: http.IncomingMessage): boolean {
    const proto = request.headers['sec-websocket-protocol'];
    return typeof proto === 'string' && proto.includes('vite-hmr');
}

// Forward Vite's HMR websocket to the Vite dev server.
export function proxyViteHmrUpgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer
): void {
    const upstream = net.connect(VITE_PORT, VITE_HOST, () => {
        upstream.write(buildUpgradeRequest(request));
        if (head.length > 0) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
    });
    upstream.on('error', (err) => {
        logger.warn('vite hmr proxy failed: %s', err);
        if (!socket.destroyed) socket.destroy();
    });
    socket.on('error', () => upstream.destroy());
    finished(socket, () => {
        if (!upstream.destroyed) upstream.destroy();
    });
}

function buildUpgradeRequest(request: http.IncomingMessage): string {
    const lines = [`GET ${request.url ?? '/'} HTTP/1.1`];
    for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        lines.push(
            `${key}: ${Array.isArray(value) ? value.join(', ') : value}`
        );
    }
    return `${lines.join('\r\n')}\r\n\r\n`;
}
