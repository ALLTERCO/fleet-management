// MCP core for agents. Docs/lookup tools read generated files only; live
// tools are added only when the HTTP route supplies an authenticated RPC
// executor and caller. The stdio script passes no executor, so it stays
// documentation-only.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {operateConfirm, operateRead, operateWrite} from './agentOperate.js';
import {
    callLiveTool,
    isLiveTool,
    liveToolDefinitions,
    type RpcExecutor
} from './liveTools.js';
import {McpError, mcpErrorData} from './mcpErrors.js';
import {levelAllowsWrite, type McpLevel} from './mcpGovernance.js';
import {readCatalog, requireDottedMethod} from './mcpPolicy.js';

const SERVER_NAME = 'fleet-manager-docs';
const SERVER_VERSION = '1.0.0';
export const MCP_PROTOCOL_VERSION = '2025-11-25';
const MAX_READ_BYTES = 512 * 1024;
const DEFAULT_RESOURCE_CHUNK_CHARS = 64 * 1024;
const MAX_RESOURCE_CHUNK_CHARS = 128 * 1024;
const DEFAULT_SEARCH_LIMIT = 8;

// Four levels up from both src/modules/ai and dist/modules/ai.
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const AI_INDEX_PATH = path.join(REPO_ROOT, 'docs/generated/ai-index.json');
const RPC_INVENTORY_PATH = path.join(
    REPO_ROOT,
    'docs/generated/backend-rpc-inventory.json'
);
const FRONTEND_DEPS_PATH = path.join(
    REPO_ROOT,
    'docs/generated/frontend-backend-dependencies.json'
);

export interface McpMessage {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: {
        uri?: string;
        name?: string;
        arguments?: Record<string, unknown>;
    };
}

interface AiIndex {
    mcpResources: {
        uri: string;
        source: string;
        role: string;
        safeMode: string;
    }[];
    mcpSearchResources: {id: string; source: string; role: string}[];
    resources: {id: string; path: string}[];
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function readText(file: string): string {
    return fs.readFileSync(file, 'utf8');
}

function safePath(relativePath: string): string {
    const absolute = path.resolve(REPO_ROOT, relativePath);
    if (!absolute.startsWith(REPO_ROOT + path.sep)) {
        throw new Error(`Path escapes repository: ${relativePath}`);
    }
    return absolute;
}

export function loadAiIndex(): AiIndex {
    return readJson<AiIndex>(AI_INDEX_PATH);
}

function readOnlyMcpResources(index = loadAiIndex()) {
    return index.mcpResources.filter((item) => item.safeMode === 'read-only');
}

function mimeForPath(file: string): string {
    if (file.endsWith('.json')) return 'application/json';
    if (file.endsWith('.ts')) return 'text/typescript';
    return 'text/markdown';
}

export function listResources(index = loadAiIndex()) {
    return readOnlyMcpResources(index).map((item) => ({
        uri: item.uri,
        name: item.uri.replace('fm://', ''),
        description: item.role,
        mimeType: mimeForPath(item.source)
    }));
}

function resourceSource(uri: string, index = loadAiIndex()): string {
    const resource = readOnlyMcpResources(index).find(
        (item) => item.uri === uri
    );
    if (!resource) throw new Error(`Unknown read-only resource: ${uri}`);
    return resource.source;
}

export function readResource(uri: string, index = loadAiIndex()) {
    const source = resourceSource(uri, index);
    const file = safePath(source);
    const stat = fs.statSync(file);
    if (stat.size > MAX_READ_BYTES) {
        return {
            uri,
            mimeType: mimeForPath(source),
            text: JSON.stringify(
                {
                    source,
                    sizeBytes: stat.size,
                    message:
                        'Resource is large. Use read_resource_chunk or a specific lookup tool.'
                },
                null,
                2
            )
        };
    }
    return {uri, mimeType: mimeForPath(source), text: readText(file)};
}

export function readResourceChunk(
    input: Record<string, unknown> | undefined,
    index = loadAiIndex()
) {
    const uri = String(input?.uri ?? '').trim();
    const offset = Number(input?.offset ?? 0);
    const maxChars = Number(input?.maxChars ?? DEFAULT_RESOURCE_CHUNK_CHARS);
    if (!Number.isInteger(offset) || offset < 0) {
        throw new McpError(
            'invalid_params',
            'offset must be a non-negative integer'
        );
    }
    if (
        !Number.isInteger(maxChars) ||
        maxChars < 1 ||
        maxChars > MAX_RESOURCE_CHUNK_CHARS
    ) {
        throw new McpError(
            'invalid_params',
            `maxChars must be between 1 and ${MAX_RESOURCE_CHUNK_CHARS}`
        );
    }
    const source = resourceSource(uri, index);
    const content = readText(safePath(source));
    if (offset > content.length) {
        throw new McpError('invalid_params', 'offset exceeds resource length');
    }
    const text = content.slice(offset, offset + maxChars);
    const nextOffset = offset + text.length;
    return {
        uri,
        source,
        mimeType: mimeForPath(source),
        totalChars: content.length,
        offset,
        nextOffset: nextOffset < content.length ? nextOffset : null,
        text
    };
}

function searchableResources(index = loadAiIndex()) {
    const resources = new Map<string, {id: string; path: string}>();
    for (const item of index.mcpSearchResources) {
        resources.set(item.source, {id: item.id, path: item.source});
    }
    for (const item of readOnlyMcpResources(index)) {
        resources.set(item.source, {id: item.uri, path: item.source});
    }
    return [...resources.values()];
}

function snippet(text: string, pos: number): string {
    const start = Math.max(0, pos - 140);
    const end = Math.min(text.length, pos + 280);
    return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

export function searchDocs(
    input: Record<string, unknown> | undefined,
    index = loadAiIndex()
) {
    const query = String(input?.query ?? '')
        .trim()
        .toLowerCase();
    const limit = Number(input?.limit ?? DEFAULT_SEARCH_LIMIT);
    if (!query) return [];
    const hits: {id: string; path: string; snippet: string}[] = [];
    for (const item of searchableResources(index)) {
        const file = safePath(item.path);
        if (!fs.existsSync(file) || fs.statSync(file).size > MAX_READ_BYTES) {
            continue;
        }
        const text = readText(file);
        const pos = text.toLowerCase().indexOf(query);
        if (pos === -1) continue;
        hits.push({id: item.id, path: item.path, snippet: snippet(text, pos)});
        if (hits.length >= limit) break;
    }
    return hits;
}

export function getRpcMethod(input?: Record<string, unknown>) {
    const name = requireDottedMethod(input);
    const [namespace, ...parts] = name.split('.');
    const method = parts.join('.');
    const inventory = readJson<{
        methods: {namespace: string; method: string}[];
    }>(RPC_INVENTORY_PATH);
    const rows = inventory.methods.filter(
        (row) =>
            row.namespace.toLowerCase() === namespace &&
            row.method.toLowerCase() === method
    );
    return {method: name, rows};
}

export function getApiMethod(input?: Record<string, unknown>) {
    const name = requireDottedMethod(input);
    const entry = readCatalog().methods.find((method) => method.id === name);
    if (!entry) {
        throw new Error(
            `Unknown API method: ${name}. Check docs/generated/api-catalog.json.`
        );
    }
    return entry;
}

export function findFrontendCallers(input?: Record<string, unknown>) {
    const method = requireDottedMethod(input);
    const deps = readJson<{calls: {method?: string}[]}>(FRONTEND_DEPS_PATH);
    const calls = deps.calls.filter((call) =>
        String(call.method ?? '')
            .toLowerCase()
            .includes(method)
    );
    return {method, calls};
}

const METHOD_INPUT_SCHEMA = {
    type: 'object',
    properties: {method: {type: 'string'}},
    required: ['method']
};

// Output schemas let agents validate structuredContent instead of parsing
// free text. An empty {} schema means "any value" (the raw RPC result).
const API_METHOD_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        id: {type: 'string'},
        namespace: {type: 'string'},
        fullMethod: {type: 'string'},
        namespaceKind: {type: 'string', enum: ['device', 'fleet-manager']},
        permission: {type: 'object'},
        safety: {type: 'object'}
    },
    required: ['id', 'namespaceKind', 'safety']
};

// Single home for the tool surface: listing and dispatch derive from it.
const TOOLS = [
    {
        name: 'read_resource_chunk',
        description:
            'Read a bounded character range from any listed read-only MCP resource. Use this for resources/read results that report the file is large.',
        inputSchema: {
            type: 'object',
            properties: {
                uri: {type: 'string'},
                offset: {type: 'integer', minimum: 0},
                maxChars: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_RESOURCE_CHUNK_CHARS
                }
            },
            required: ['uri']
        },
        annotations: {readOnlyHint: true},
        handler: readResourceChunk
    },
    {
        name: 'search_docs',
        description: 'Search small AI-indexed Fleet Manager docs.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {type: 'string'},
                limit: {type: 'integer', minimum: 1, maximum: 20}
            },
            required: ['query']
        },
        annotations: {readOnlyHint: true},
        handler: searchDocs
    },
    {
        name: 'get_api_method',
        description:
            'Look up one API method in the agent catalog: namespaceKind (device|fleet-manager), descriptions, params/response schemas, permission, safety hints, and the recommended Host SDK wrapper. Prefer this over get_rpc_method.',
        inputSchema: METHOD_INPUT_SCHEMA,
        outputSchema: API_METHOD_OUTPUT_SCHEMA,
        annotations: {readOnlyHint: true},
        handler: getApiMethod
    },
    {
        name: 'get_rpc_method',
        description:
            'Look up a backend RPC method in the generated inventory (declaration provenance and source only; get_api_method returns the richer agent-facing object).',
        inputSchema: METHOD_INPUT_SCHEMA,
        annotations: {readOnlyHint: true},
        handler: getRpcMethod
    },
    {
        name: 'find_frontend_callers',
        description: 'Find frontend calls for a backend method.',
        inputSchema: METHOD_INPUT_SCHEMA,
        annotations: {readOnlyHint: true},
        handler: findFrontendCallers
    }
];

export function toolDefinitions() {
    return TOOLS.map(({handler, ...definition}) => definition);
}

// Object results also carry structuredContent so agents can validate
// against a tool's outputSchema instead of parsing the text mirror.
function toolResult(value: unknown) {
    const structured =
        value !== null && typeof value === 'object' && !Array.isArray(value);
    return {
        content: [{type: 'text', text: JSON.stringify(value, null, 2)}],
        ...(structured ? {structuredContent: value} : {})
    };
}

function callTool(name: string, args: Record<string, unknown>) {
    const tool = TOOLS.find((entry) => entry.name === name);
    if (!tool) {
        throw new McpError('unknown_tool', `Unknown tool: ${name}`, {
            tool: name
        });
    }
    return toolResult(tool.handler(args));
}

function response(id: McpMessage['id'], result: unknown) {
    return {jsonrpc: '2.0', id, result};
}

export function errorResponse(id: McpMessage['id'], error: unknown) {
    const message =
        error instanceof Error ? error.message : String(error ?? 'error');
    const data = mcpErrorData(error);
    return {
        jsonrpc: '2.0',
        id,
        error: {code: -32000, message, ...(data ? {data} : {})}
    };
}

// Live tools appear only when the caller supplies an executor + caller
// identity (the /mcp route binds both to the request's user). Stdio and
// unauthenticated paths pass none, so they stay documentation-only.
export interface McpCaller {
    username: string;
    organizationId: string | null;
}
export type McpAudit = (entry: {
    tool: string;
    method?: string;
    success: boolean;
    errorMessage?: string;
}) => Promise<number | null>;
export interface McpContext {
    execute?: RpcExecutor;
    caller?: McpCaller;
    audit?: McpAudit;
    // Effective capability level (env ceiling ∩ tenant) resolved by the route;
    // absent defaults to 'read' (the safe floor, e.g. the docs-only stdio path).
    level?: McpLevel;
}

interface ToolAnnotations {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}

type FmHandler = (
    args: Record<string, unknown>,
    ctx: Required<McpContext>
) => Promise<ReturnType<typeof toolResult>>;

interface FmTool {
    name: string;
    toolset: 'read' | 'write';
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    annotations: ToolAnnotations;
    handler: FmHandler;
}

const READ_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        method: {type: 'string'},
        result: {},
        truncated: {type: 'boolean'},
        nextCursor: {type: 'string'},
        rowLimit: {type: 'integer'},
        evidence: {type: 'array'}
    },
    required: ['method', 'result', 'truncated', 'evidence']
};

const WRITE_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        status: {type: 'string', enum: ['executed', 'confirmation_required']},
        method: {type: 'string'}
    },
    required: ['status', 'method']
};

const CONFIRM_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        status: {type: 'string', enum: ['executed']},
        method: {type: 'string'},
        result: {},
        audit: {
            type: 'object',
            properties: {enqueued: {type: 'boolean'}},
            required: ['enqueued']
        }
    },
    required: ['status', 'method', 'result', 'audit']
};

const METHOD_PARAMS_SCHEMA = {
    type: 'object',
    properties: {
        method: {type: 'string'},
        params: {type: 'object'},
        // Opaque cursor from a prior truncated read; fetches the next page.
        cursor: {type: 'string'}
    },
    required: ['method']
};

// Thin transports over agentOperate: translate MCP args in, wrap result out.
const FM_TOOLS: FmTool[] = [
    {
        name: 'fm_read',
        toolset: 'read',
        description:
            'Run any Fleet Manager read-only method (group.List, location.List, dashboard.*, energy.*, ...). Refuses device firmware methods, writes, and escape hatches. Use get_api_method first for a method params.',
        inputSchema: METHOD_PARAMS_SCHEMA,
        outputSchema: READ_OUTPUT_SCHEMA,
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false
        },
        handler: async (args, ctx) =>
            toolResult(
                await operateRead(ctx, {
                    method: String(args.method ?? ''),
                    params: args.params as Record<string, unknown> | undefined,
                    cursor: args.cursor as string | undefined
                })
            )
    },
    {
        name: 'fm_write',
        toolset: 'write',
        description:
            'Run a Fleet Manager write permitted by the capability policy and the caller\'s RBAC. mode:"execute" runs additive writes immediately; destructive writes (update/delete) come back as confirmation_required with a token for fm_confirm_write. mode:"prepare" (default) always previews.',
        inputSchema: {
            type: 'object',
            properties: {
                method: {type: 'string'},
                params: {type: 'object'},
                mode: {type: 'string', enum: ['prepare', 'execute']}
            },
            required: ['method']
        },
        outputSchema: WRITE_OUTPUT_SCHEMA,
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: false
        },
        handler: async (args, ctx) =>
            toolResult(
                await operateWrite(ctx, {
                    method: String(args.method ?? ''),
                    params: args.params as Record<string, unknown> | undefined,
                    mode: args.mode as 'prepare' | 'execute' | undefined
                })
            )
    },
    {
        name: 'fm_confirm_write',
        toolset: 'write',
        description:
            'Execute a write returned as confirmation_required by fm_write. Requires the confirmationToken; runs only the exact user+method+params it was issued for. Tokens are single-use.',
        inputSchema: {
            type: 'object',
            properties: {confirmationToken: {type: 'string'}},
            required: ['confirmationToken']
        },
        outputSchema: CONFIRM_OUTPUT_SCHEMA,
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: false
        },
        handler: async (args, ctx) =>
            toolResult(await operateConfirm(ctx, args.confirmationToken))
    }
];

// Write tools are hidden and refused at the 'read' level. The effective level
// is resolved once (env ∩ tenant) and passed in.
function visibleFmTools(level: McpLevel): FmTool[] {
    return levelAllowsWrite(level)
        ? FM_TOOLS
        : FM_TOOLS.filter((t) => t.toolset !== 'write');
}

function fmToolDefinitions(level: McpLevel) {
    return visibleFmTools(level).map(({handler, toolset, ...definition}) => ({
        ...definition,
        toolset
    }));
}

async function callFmTool(
    name: string,
    args: Record<string, unknown>,
    ctx: Required<McpContext>
) {
    const tool = visibleFmTools(ctx.level).find((entry) => entry.name === name);
    if (!tool) {
        if (!levelAllowsWrite(ctx.level) && isFmTool(name)) {
            throw new McpError(
                'read_only_mode',
                `${name} is disabled: MCP is read-only at this level`,
                {tool: name}
            );
        }
        throw new McpError('unknown_tool', `Unknown tool: ${name}`, {
            tool: name
        });
    }
    return tool.handler(args, ctx);
}

// Stateful tools (touch data or state) are audited at the doorway; the
// stateless docs lookups are not.
export function isAuditableTool(name: string): boolean {
    return isLiveTool(name) || isFmTool(name);
}

function isFmTool(name: string): boolean {
    return FM_TOOLS.some((entry) => entry.name === name);
}

// Write-toolset tools consume the write budget; everything else the read.
export function isWriteTool(name: string): boolean {
    return FM_TOOLS.some((t) => t.name === name && t.toolset === 'write');
}

/** One JSON-RPC message in, one response out; null for notifications. */
export async function handleRequest(message: McpMessage, ctx: McpContext = {}) {
    // Effective level: the route's resolved value (env ∩ tenant), or the safe
    // 'read' floor for callers that don't supply one (stdio, tests).
    const level: McpLevel = ctx.level ?? 'read';
    if (message.method === 'initialize') {
        return response(message.id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {resources: {}, tools: {}},
            serverInfo: {name: SERVER_NAME, version: SERVER_VERSION}
        });
    }
    if (message.method === 'ping') {
        return response(message.id, {});
    }
    if (message.method === 'resources/list') {
        return response(message.id, {resources: listResources()});
    }
    if (message.method === 'resources/read') {
        const item = readResource(String(message.params?.uri ?? ''));
        return response(message.id, {contents: [item]});
    }
    if (message.method === 'tools/list') {
        const tools = ctx.execute
            ? [
                  ...toolDefinitions(),
                  ...liveToolDefinitions(),
                  ...fmToolDefinitions(level)
              ]
            : toolDefinitions();
        return response(message.id, {tools});
    }
    if (message.method === 'tools/call') {
        const name = String(message.params?.name ?? '');
        const args = message.params?.arguments ?? {};
        const audit: McpAudit = ctx.audit ?? (async () => null);
        if (isFmTool(name)) {
            if (!ctx.execute || !ctx.caller) {
                throw new Error(`${name} requires an authenticated call`);
            }
            return response(
                message.id,
                await callFmTool(name, args, {
                    execute: ctx.execute,
                    caller: ctx.caller,
                    audit,
                    level
                })
            );
        }
        if (isLiveTool(name)) {
            if (!ctx.execute) {
                throw new Error(
                    `Live tool ${name} requires an authenticated call`
                );
            }
            const res = await callLiveTool(name, args, ctx.execute);
            await audit({tool: name, success: true});
            return response(message.id, res);
        }
        return response(message.id, callTool(name, args));
    }
    if (message.id === undefined) return null;
    throw new Error(`Unsupported MCP method: ${message.method}`);
}
