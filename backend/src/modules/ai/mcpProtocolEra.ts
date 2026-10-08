// What differs between the two MCP eras at the protocol edge.
//
// Session revisions (2025-11-25 and earlier) agree a version at `initialize`
// and may hold an Mcp-Session-Id; the server may send requests on the stream.
// The stateless revision (2026-07-28) carries its version and client
// capabilities in every request's `_meta`, has no handshake, and returns a
// request for input inside the result for the client to answer on a retry.
// Both run the same tool core; this module holds only the differences. Which
// revision belongs to which era is decided by the table in fleetDocsMcp.ts.

import {jsonRpcErrorCode, McpError} from './mcpErrors.js';

export type ProtocolEra = 'session' | 'stateless';

const META_PREFIX = 'io.modelcontextprotocol/';
const META_VERSION = `${META_PREFIX}protocolVersion`;
const META_CAPABILITIES = `${META_PREFIX}clientCapabilities`;
const META_CLIENT_INFO = `${META_PREFIX}clientInfo`;
const META_LOG_LEVEL = `${META_PREFIX}logLevel`;
const META_SERVER_INFO = `${META_PREFIX}serverInfo`;
export const META_SUBSCRIPTION_ID = `${META_PREFIX}subscriptionId`;

/** What a stateless request says about its client, read from `_meta`. */
export interface StatelessMeta {
    clientCapabilities: Record<string, unknown>;
    clientInfo?: unknown;
    logLevel?: string;
}

export type RequestProtocol =
    | {version: string; era: 'session'}
    | {version: string; era: 'stateless'; meta: StatelessMeta};

const LOG_LEVELS = new Set([
    'debug',
    'info',
    'notice',
    'warning',
    'error',
    'critical',
    'alert',
    'emergency'
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The revision a request names in its `_meta`, when it names one. */
export function statelessMetaVersion(meta: unknown): string | undefined {
    if (!isPlainObject(meta)) return undefined;
    const version = meta[META_VERSION];
    return typeof version === 'string' ? version : undefined;
}

export function unsupportedProtocolVersion(
    requested: string,
    supported: readonly string[]
): McpError {
    return new McpError(
        'unsupported_protocol_version',
        'Unsupported protocol version',
        {details: {supported: [...supported], requested}}
    );
}

function missingMeta(field: string): McpError {
    return new McpError('invalid_params', `The request _meta needs ${field}`, {
        retryable: false
    });
}

/**
 * The per-request fields 2026-07-28 requires. A missing required field is a
 * malformed request (-32602); a header that disagrees with the body is a
 * HeaderMismatch, because intermediaries may have routed on the header.
 */
export function readStatelessMeta(
    params: {_meta?: unknown} | undefined,
    headerVersion: string | undefined
): StatelessMeta {
    const meta = params?._meta;
    const version = statelessMetaVersion(meta);
    if (!isPlainObject(meta) || version === undefined) {
        throw missingMeta(META_VERSION);
    }
    const capabilities = meta[META_CAPABILITIES];
    if (!isPlainObject(capabilities)) throw missingMeta(META_CAPABILITIES);
    const logLevel = meta[META_LOG_LEVEL];
    if (
        logLevel !== undefined &&
        (typeof logLevel !== 'string' || !LOG_LEVELS.has(logLevel))
    ) {
        throw new McpError('invalid_params', 'logLevel must be a syslog level');
    }
    if (headerVersion !== version) {
        throw headerMismatch('MCP-Protocol-Version');
    }
    return {
        clientCapabilities: capabilities,
        ...(meta[META_CLIENT_INFO] !== undefined
            ? {clientInfo: meta[META_CLIENT_INFO]}
            : {}),
        ...(logLevel !== undefined ? {logLevel} : {})
    };
}

function headerMismatch(header: string): McpError {
    return new McpError(
        'header_mismatch',
        `The ${header} header is missing or does not match the body`,
        {retryable: false}
    );
}

const BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/;
const PLAIN_HEADER_VALUE = /^[\x20-\x7e]*$/;

// A header value as the client meant it: the Base64 sentinel form is how a
// name outside plain ASCII crosses HTTP.
function decodeHeaderValue(value: string): string | undefined {
    const encoded = BASE64_SENTINEL.exec(value);
    if (encoded) return Buffer.from(encoded[1], 'base64').toString('utf8');
    return PLAIN_HEADER_VALUE.test(value) ? value : undefined;
}

// The body field Mcp-Name mirrors, for the methods that require it.
const NAMED_METHODS: Readonly<
    Record<
        string,
        (params: {name?: unknown; uri?: unknown; taskId?: unknown}) => unknown
    >
> = {
    'tools/call': (params) => params.name,
    'prompts/get': (params) => params.name,
    'resources/read': (params) => params.uri,
    // The Tasks extension routes on the task id.
    'tasks/get': (params) => params.taskId,
    'tasks/update': (params) => params.taskId,
    'tasks/cancel': (params) => params.taskId
};

/**
 * Mcp-Method and Mcp-Name must mirror the body exactly. A load balancer or
 * gateway may act on the header while this server acts on the body, so a
 * disagreement is refused rather than resolved either way.
 */
export function assertMirroredHeaders(
    message: {
        method?: string;
        params?: {name?: unknown; uri?: unknown; taskId?: unknown};
    },
    headers: {method: string | undefined; name: string | undefined}
): void {
    const method = message.method ?? '';
    if (
        headers.method === undefined ||
        decodeHeaderValue(headers.method) !== method
    ) {
        throw headerMismatch('Mcp-Method');
    }
    const named = NAMED_METHODS[method];
    if (!named) return;
    const expected = named(message.params ?? {});
    if (
        headers.name === undefined ||
        typeof expected !== 'string' ||
        decodeHeaderValue(headers.name) !== expected
    ) {
        throw headerMismatch('Mcp-Name');
    }
}

// Methods only one era defines; every other method both eras share.
const SESSION_ONLY_METHODS = new Set([
    'initialize',
    'ping',
    'logging/setLevel',
    'resources/subscribe',
    'resources/unsubscribe'
]);
const STATELESS_ONLY_METHODS = new Set([
    'server/discover',
    'subscriptions/listen',
    // The Tasks extension is defined for 2026-07-28 only.
    'tasks/get',
    'tasks/update',
    'tasks/cancel'
]);

/** Whether a method exists in the era the request speaks. */
export function eraOffers(era: ProtocolEra, method: string): boolean {
    return era === 'session'
        ? !STATELESS_ONLY_METHODS.has(method)
        : !SESSION_ONLY_METHODS.has(method);
}

/** The JSON-RPC code an error carries in the era the request speaks. */
export function eraErrorCode(era: ProtocolEra, error: unknown): number {
    // 2026-07-28 moved resource-not-found from -32002 to Invalid Params.
    if (
        era === 'stateless' &&
        error instanceof McpError &&
        error.reason === 'resource_not_found'
    ) {
        return -32602;
    }
    return jsonRpcErrorCode(error);
}

/** Whether the client said it can show a form, the only prompt Fleet sends. */
export function declaresFormElicitation(
    capabilities: Record<string, unknown>
): boolean {
    const elicitation = capabilities.elicitation;
    if (!isPlainObject(elicitation)) return false;
    // An empty object declares form mode, for compatibility with 2025-06-18.
    return 'form' in elicitation || !('url' in elicitation);
}

interface CacheHint {
    ttlMs: number;
    cacheScope: 'public' | 'private';
}

// Lists change only with a deployment or a new key, so a client may reuse
// them for a while. Anything that depends on the credential is private.
const LIST_TTL_MS = 5 * 60_000;
const PRIVATE_LIST: CacheHint = {ttlMs: LIST_TTL_MS, cacheScope: 'private'};
const LIVE_READ: CacheHint = {ttlMs: 0, cacheScope: 'private'};

/** Caching hints for the results 2026-07-28 makes cacheable. */
const CACHE_HINTS: Readonly<
    Record<string, (live: boolean) => CacheHint | undefined>
> = {
    'server/discover': () => PRIVATE_LIST,
    'tools/list': () => PRIVATE_LIST,
    'prompts/list': () => ({ttlMs: LIST_TTL_MS, cacheScope: 'public'}),
    'resources/list': () => PRIVATE_LIST,
    'resources/templates/list': () => PRIVATE_LIST,
    'resources/read': (live) => (live ? LIVE_READ : PRIVATE_LIST)
};

// Results that are not the answer yet: a question (MRTR) or a task handle.
const DEFERRED_RESULT_TYPES = new Set(['input_required', 'task']);

/**
 * Stamps a core result the way 2026-07-28 requires: every result names its
 * type, cacheable complete results carry caching hints, and the server names
 * itself. `live` marks a read whose content changes from one call to the next.
 */
export function statelessResult(
    shape: {method: string; live: boolean; server: Record<string, unknown>},
    result: Record<string, unknown>
): Record<string, unknown> {
    const kind = DEFERRED_RESULT_TYPES.has(String(result.resultType))
        ? String(result.resultType)
        : 'complete';
    const hint =
        kind === 'complete'
            ? CACHE_HINTS[shape.method]?.(shape.live)
            : undefined;
    return {
        ...result,
        resultType: kind,
        ...hint,
        _meta: {
            ...(isPlainObject(result._meta) ? result._meta : {}),
            [META_SERVER_INFO]: shape.server
        }
    };
}

/**
 * Thrown from inside a tool when the human has to answer first and the client
 * speaks the stateless era. The core turns it into the interim result, never
 * into a tool error, so nothing else may catch it.
 */
export class InputRequiredSignal extends Error {
    readonly result: {
        resultType: 'input_required';
        inputRequests: Record<string, unknown>;
        requestState: string;
    };

    constructor(inputRequests: Record<string, unknown>, requestState: string) {
        super('input required');
        this.name = 'InputRequiredSignal';
        this.result = {
            resultType: 'input_required',
            inputRequests,
            requestState
        };
    }
}
