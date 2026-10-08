// Outside callers (a doorbell service, a form, a CI job) reach a Node-RED
// webhook through Fleet Manager's public URL. No Fleet Manager login: the
// fm-webhook-in node checks its own per-hook secret. This route only limits
// size and rate, strips our credentials, and adds the proxy secret Node-RED
// requires.

import type {IncomingMessage} from 'node:http';
import express from 'express';
import log4js from 'log4js';
import {tuning} from '../../../config/tuning';
import {nodeRedServerHeaders} from '../../nodeRed/flowClient';
import {httpRouteLimit} from '../rateLimit';
import {paramStr} from '../utils/params';
import {
    proxySecretMissing,
    requireProxySecret,
    sendProxyError
} from './nodeRedProxy';

const logger = log4js.getLogger('automation-hooks');

// The fm-webhook-in node's own rule, so an id it rejects never routes here.
const HOOK_ID = /^[A-Za-z0-9_-]{8,128}$/;

// Only what the node needs. Cookies, Authorization and our own x-fm-* never
// leave; the hook secret is the one x-fm-* header the node must see.
const FORWARDED_HEADERS = ['content-type', 'x-fm-hook-secret'] as const;

const HOOK_PATH = '/fm-hooks';

// Same default as Node-RED's settings.js httpNodeRoot.
const DEFAULT_NODE_ROOT = '/node-red/api';

export function isValidHookId(hookId: string): boolean {
    return HOOK_ID.test(hookId);
}

/** Where Node-RED serves this hook: its http-node root plus /fm-hooks/:id. */
export function hookTargetUrl(input: {hookId: string; search: string}): URL {
    const target = new URL(tuning.nodeRed.proxyTarget);
    const root = target.pathname === '/' ? DEFAULT_NODE_ROOT : target.pathname;
    target.pathname = `${root.replace(/\/+$/, '')}${HOOK_PATH}/${input.hookId}`;
    target.search = input.search;
    return target;
}

/** Copies the allowed headers and adds the proxy marker and secret. */
export function hookForwardHeaders(
    incoming: IncomingMessage['headers']
): Record<string, string> {
    const headers: Record<string, string> = {'x-fm-node-red-proxy': '1'};
    for (const name of FORWARDED_HEADERS) {
        const value = incoming[name];
        if (typeof value === 'string') headers[name] = value;
    }
    requireProxySecret();
    return {...headers, ...nodeRedServerHeaders()};
}

function declaredTooLarge(req: express.Request, limit: number): boolean {
    const declared = Number(req.get('content-length') ?? 0);
    return Number.isFinite(declared) && declared > limit;
}

/** Reads the body up to `limit` bytes; null when it is larger. */
export function readLimitedBody(
    req: IncomingMessage,
    limit: number
): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                req.removeAllListeners('data');
                req.resume();
                resolve(null);
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function searchOf(originalUrl: string): string {
    const index = originalUrl.indexOf('?');
    return index < 0 ? '' : originalUrl.slice(index);
}

async function callNodeRedHook(input: {
    req: express.Request;
    body: Buffer | undefined;
}): Promise<Response> {
    const {req, body} = input;
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        tuning.nodeRed.proxyTimeoutMs
    );
    try {
        return await fetch(
            hookTargetUrl({
                hookId: paramStr(req.params.hookId),
                search: searchOf(req.originalUrl)
            }),
            {
                method: req.method,
                headers: hookForwardHeaders(req.headers),
                ...(body ? {body: new Uint8Array(body)} : {}),
                redirect: 'manual',
                signal: controller.signal
            }
        );
    } finally {
        clearTimeout(timer);
    }
}

async function relayResponse(
    upstream: Response,
    res: express.Response
): Promise<void> {
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
}

function rejectBadHookId(res: express.Response): void {
    res.status(400).json({error: 'Invalid hook id', code: 'invalid_hook_id'});
}

function rejectTooLarge(res: express.Response): void {
    res.status(413).json({error: 'Webhook body too large', code: 'too_large'});
}

async function readHookBody(
    req: express.Request
): Promise<Buffer | undefined | null> {
    if (req.method === 'GET') return undefined;
    const limit = tuning.nodeRed.hookBodyLimitBytes;
    if (declaredTooLarge(req, limit)) return null;
    return readLimitedBody(req, limit);
}

async function forwardHook(
    req: express.Request,
    res: express.Response
): Promise<void> {
    if (proxySecretMissing()) {
        sendProxyError(res, 'secretMissing');
        return;
    }
    const body = await readHookBody(req);
    if (body === null) {
        rejectTooLarge(res);
        return;
    }
    await relayResponse(await callNodeRedHook({req, body}), res);
}

// Logs the hook id and reason only; the URL can carry the hook's ?token=.
function handleHookFailure(input: {
    res: express.Response;
    hookId: string;
    error: unknown;
}): void {
    const reason =
        input.error instanceof Error ? input.error.name : 'unknown error';
    logger.warn(
        'Node-RED webhook %s could not be forwarded: %s',
        input.hookId,
        reason
    );
    sendProxyError(input.res, 'unavailable');
}

// Public on purpose: no login gate. The node checks the per-hook secret.
function hookHandler(req: express.Request, res: express.Response): void {
    if (!isValidHookId(paramStr(req.params.hookId))) {
        rejectBadHookId(res);
        return;
    }
    forwardHook(req, res).catch((error) =>
        handleHookFailure({res, hookId: paramStr(req.params.hookId), error})
    );
}

// Read at router build time, like the other tuning-driven routes.
function hookLimit() {
    return {
        name: 'automation-hooks',
        capacityPerMin: tuning.nodeRed.hookRateLimitPerMin
    };
}

// Same methods as the fm-webhook-in node. Written out with the limiter inline:
// the HTTP inventory and auth-matrix generators read route calls from source.
// The budget is keyed by name, so every method shares one per-client limit.
export function buildAutomationHooksRouter(): express.Router {
    const router = express.Router();
    router.get('/:hookId', httpRouteLimit(hookLimit()), hookHandler);
    router.post('/:hookId', httpRouteLimit(hookLimit()), hookHandler);
    router.put('/:hookId', httpRouteLimit(hookLimit()), hookHandler);
    return router;
}
