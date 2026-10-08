// fm-webhook-in: one shared route /fm-hooks/:hookId, one handler per hook id.
// FM serves the public URL /automation-hooks/:hookId and forwards here.

const crypto = require('node:crypto');

const HOOK_ROUTE = '/fm-hooks/:hookId';
const HOOK_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SECRET_HEADER = 'x-fm-hook-secret';
// Same as FM_NODE_RED_HOOK_BODY_LIMIT_BYTES, the most FM forwards.
const MAX_BODY_BYTES = 256 * 1024;

function digest(value) {
    return crypto.createHash('sha256').update(String(value)).digest();
}

// Hashing first gives equal lengths, so the compare time leaks nothing.
function secretMatches(expected, provided) {
    if (!expected || !provided) return false;
    return crypto.timingSafeEqual(digest(expected), digest(provided));
}

// URL tokens land in access logs, so they need an explicit per-node opt-in.
function providedSecret(req, allowQueryToken) {
    const header = req.headers?.[SECRET_HEADER];
    if (typeof header === 'string' && header) return header;
    const token = allowQueryToken ? req.query?.token : '';
    return typeof token === 'string' ? token : '';
}

function isValidHookId(hookId) {
    return HOOK_ID_PATTERN.test(String(hookId || ''));
}

function withoutKey(record, key) {
    const copy = {...(record || {})};
    delete copy[key];
    return copy;
}

const BODY_PARSERS = [
    [/json/i, (text) => JSON.parse(text)],
    [
        /x-www-form-urlencoded/i,
        (text) => Object.fromEntries(new URLSearchParams(text))
    ]
];

function parseBody(text, contentType) {
    if (!text) return {};
    const parser = BODY_PARSERS.find(([pattern]) => pattern.test(contentType));
    return parser ? parser[1](text) : text;
}

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(
                    Object.assign(new Error('body too large'), {status: 413})
                );
                return;
            }
            chunks.push(Buffer.from(chunk));
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function requestBody(req) {
    if (req.body !== undefined) return req.body;
    const text = await readRawBody(req);
    return parseBody(text, String(req.headers?.['content-type'] || ''));
}

// No msg.method or msg.topic: operation nodes read those as the FM method.
function hookMessage(req, body) {
    return {
        payload: body,
        headers: withoutKey(req.headers, SECRET_HEADER),
        query: withoutKey(req.query, 'token'),
        fm: {hookId: String(req.params.hookId), httpMethod: req.method}
    };
}

module.exports = {
    HOOK_ROUTE,
    MAX_BODY_BYTES,
    SECRET_HEADER,
    hookMessage,
    isValidHookId,
    providedSecret,
    requestBody,
    secretMatches
};
