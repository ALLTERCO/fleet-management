import type express from 'express';
import log4js from 'log4js';
import {grafanaAuthProxyHeaders} from '../../../config/grafanaApi';
import * as Observability from '../../Observability';
import {bestEffort} from '../../util/fireAndForget';

const logger = log4js.getLogger('grafana-proxy');

// Framing headers break clients on truncation; set-cookie would leak
// Grafana sessions onto the FM origin.
const SKIP_UPSTREAM_HEADERS = new Set([
    'content-length',
    'transfer-encoding',
    'content-encoding',
    'set-cookie'
]);
// Drop FM session credentials and inbound x-webauth-* / x-fm-* —
// otherwise an FM-authed user could spoof their Grafana identity
// by sending those headers from the browser.
const SKIP_REQUEST_HEADERS = new Set([
    'connection',
    'origin',
    'referer',
    'cookie',
    'authorization',
    'host'
]);
const SKIP_REQUEST_PREFIXES = ['x-webauth-', 'x-fm-'];

export type GrafanaRole = 'Admin' | 'Editor' | 'Viewer';

export interface GrafanaProxyUser {
    username: string;
    displayName?: string;
    email?: string;
    organizationId?: string;
    role: GrafanaRole;
}

export interface GrafanaProxyConfig {
    timeoutMs: number;
    maxBytes: number;
    proxySecret?: string;
    user?: GrafanaProxyUser;
}

async function* readChunks(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let readResult = await reader.read();
    while (!readResult.done) {
        yield readResult.value;
        readResult = await reader.read();
    }
}

function isSkippedRequestHeader(name: string): boolean {
    if (SKIP_REQUEST_HEADERS.has(name)) return true;
    return SKIP_REQUEST_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function buildUpstreamHeaders(
    reqHeaders: express.Request['headers'],
    cfg: GrafanaProxyConfig
): Record<string, any> {
    const out: Record<string, any> = {};
    for (const k of Object.keys(reqHeaders)) {
        if (!isSkippedRequestHeader(k.toLowerCase())) out[k] = reqHeaders[k];
    }
    if (cfg.proxySecret) out['x-fm-grafana-proxy-secret'] = cfg.proxySecret;
    if (cfg.user?.username) {
        Object.assign(out, grafanaAuthProxyHeaders(cfg.user));
        if (cfg.user.organizationId) {
            out['x-fm-organization-id'] = cfg.user.organizationId;
        }
    }
    return out;
}

function copyResponseHeaders(upstream: Response, res: express.Response) {
    upstream.headers.forEach((val, key) => {
        const lower = key.toLowerCase();
        if (lower.includes('frame')) return;
        if (SKIP_UPSTREAM_HEADERS.has(lower)) return;
        res.appendHeader(key, val);
    });
}

function methodCanCarryBody(method: string): boolean {
    return !['GET', 'HEAD'].includes(method.toUpperCase());
}

function requestBody(req: express.Request): string | undefined {
    if (!methodCanCarryBody(req.method)) return undefined;
    if (req.body === undefined) return undefined;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    if (typeof req.body === 'string') return req.body;
    return JSON.stringify(req.body);
}

async function streamBodyWithCap(
    upstream: Response,
    res: express.Response,
    _abortCtl: AbortController,
    maxBytes: number,
    fUrl: string
) {
    const reader = upstream.body?.getReader();
    if (!reader) {
        res.end();
        return;
    }
    let bytesWritten = 0;
    let exceeded = false;
    try {
        for await (const chunk of readChunks(reader)) {
            bytesWritten += chunk.byteLength ?? chunk.length ?? 0;
            if (bytesWritten > maxBytes) {
                exceeded = true;
                break;
            }
            res.write(chunk);
        }
    } catch (e: any) {
        // Propagate any mid-stream failure; otherwise 200 + truncated body.
        reader.releaseLock();
        throw e;
    }
    reader.releaseLock();
    if (exceeded) {
        logger.warn(
            'Grafana response exceeded max size %d for %s, truncating',
            maxBytes,
            fUrl
        );
        if (upstream.body) {
            await bestEffort(
                'stream-cancel.grafana-proxy',
                upstream.body.cancel()
            );
        }
    }
    res.end();
}

export async function proxyGrafanaRequest(
    req: express.Request,
    res: express.Response,
    upstreamUrl: string,
    cfg: GrafanaProxyConfig
) {
    Observability.incrementCounter('grafana_proxy_requests');
    const abortCtl = new AbortController();
    const timer = setTimeout(() => abortCtl.abort(), cfg.timeoutMs);
    const body = requestBody(req);

    try {
        const rr = await fetch(upstreamUrl, {
            method: req.method,
            headers: buildUpstreamHeaders(req.headers, cfg),
            body,
            signal: abortCtl.signal
        });
        copyResponseHeaders(rr, res);
        res.status(rr.status);
        await streamBodyWithCap(rr, res, abortCtl, cfg.maxBytes, upstreamUrl);
    } catch (e: any) {
        const isAbort = e?.name === 'AbortError';
        const ourTimeout = abortCtl.signal.aborted;
        if (isAbort && ourTimeout) {
            logger.warn(
                'Grafana proxy timeout (%dms) for %s',
                cfg.timeoutMs,
                upstreamUrl
            );
            if (!res.headersSent) res.status(504).end();
            else res.destroy();
            return;
        }
        if (isAbort) {
            logger.warn(
                'Grafana upstream aborted mid-stream for %s',
                upstreamUrl
            );
            if (!res.headersSent) res.status(502).end();
            else res.destroy();
            return;
        }
        logger.error('Grafana proxy error for %s: %s', upstreamUrl, e);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
    } finally {
        clearTimeout(timer);
    }
}
