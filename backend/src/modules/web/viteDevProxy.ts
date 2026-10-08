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

// Two dev servers, mirroring the two bundles a runtime-bm image ships: the
// template on / and the operator FM SPA on /admin/. In full-FM dev only the
// first one runs.
export const VITE_PORT = 5173;
export const VITE_ADMIN_PORT = 5174;

// Forward a UI/asset request to Vite. Registered after all API routes, so only
// unmatched (frontend) requests reach here.
export function viteDevHttpProxy(
    req: express.Request,
    res: express.Response,
    port: number = VITE_PORT
): void {
    const upstream = http.request(
        {
            host: VITE_HOST,
            port,
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

/**
 * Which dev server owns this HMR socket.
 *
 * Both bundles are told to reach HMR on the backend's port (vite.config pins
 * hmr.clientPort), so the only thing separating them is the path their base
 * gives them: the operator SPA connects under /admin/, the template under /.
 * Send an admin socket to the template server and the tab starts pulling
 * modules from the wrong graph.
 */
export function viteHmrPortFor(request: http.IncomingMessage): number {
    const url = request.url ?? '/';
    return url.startsWith('/admin') ? VITE_ADMIN_PORT : VITE_PORT;
}

// Forward Vite's HMR websocket to the Vite dev server.
export function proxyViteHmrUpgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    port: number = VITE_PORT
): void {
    const upstream = net.connect(port, VITE_HOST, () => {
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
