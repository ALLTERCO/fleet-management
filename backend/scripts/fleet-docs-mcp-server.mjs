import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {fileURLToPath} from 'node:url';

const SERVER_NAME = 'fleet-manager-docs';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';
const MAX_READ_BYTES = 512 * 1024;
const DEFAULT_SEARCH_LIMIT = 8;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const AI_INDEX_PATH = path.join(REPO_ROOT, 'docs/generated/ai-index.json');
const RPC_INVENTORY_PATH = path.join(
    REPO_ROOT,
    'docs/generated/backend-rpc-inventory.json'
);
const FRONTEND_DEPS_PATH = path.join(
    REPO_ROOT,
    'docs/generated/frontend-backend-dependencies.json'
);

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readText(file) {
    return fs.readFileSync(file, 'utf8');
}

function safePath(relativePath) {
    const absolute = path.resolve(REPO_ROOT, relativePath);
    if (!absolute.startsWith(REPO_ROOT + path.sep)) {
        throw new Error(`Path escapes repository: ${relativePath}`);
    }
    return absolute;
}

export function loadAiIndex() {
    return readJson(AI_INDEX_PATH);
}

function readOnlyMcpResources(index = loadAiIndex()) {
    return index.mcpResources.filter((item) => item.safeMode === 'read-only');
}

export function listResources(index = loadAiIndex()) {
    return readOnlyMcpResources(index).map((item) => ({
        uri: item.uri,
        name: item.uri.replace('fm://', ''),
        description: item.role,
        mimeType: mimeForPath(item.source)
    }));
}

function mimeForPath(file) {
    if (file.endsWith('.json')) return 'application/json';
    if (file.endsWith('.ts')) return 'text/typescript';
    return 'text/markdown';
}

function resourceSource(uri, index = loadAiIndex()) {
    const resource = readOnlyMcpResources(index).find(
        (item) => item.uri === uri
    );
    if (!resource) throw new Error(`Unknown read-only resource: ${uri}`);
    return resource.source;
}

export function readResource(uri, index = loadAiIndex()) {
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
                        'Resource is large. Use search_docs or a specific lookup tool.'
                },
                null,
                2
            )
        };
    }
    return {uri, mimeType: mimeForPath(source), text: readText(file)};
}

function searchableResources(index = loadAiIndex()) {
    // Existence is verified at read time against the live filesystem (see
    // searchDocs/readResource), so the index carries no baked-in exists flag.
    return index.resources.filter((item) => item.path);
}

export function searchDocs(input, index = loadAiIndex()) {
    const query = String(input?.query ?? '')
        .trim()
        .toLowerCase();
    const limit = Number(input?.limit ?? DEFAULT_SEARCH_LIMIT);
    if (!query) return [];
    const hits = [];
    for (const item of searchableResources(index)) {
        const file = safePath(item.path);
        if (!fs.existsSync(file) || fs.statSync(file).size > MAX_READ_BYTES) {
            continue;
        }
        const text = readText(file);
        const pos = text.toLowerCase().indexOf(query);
        if (pos === -1) continue;
        hits.push({
            id: item.id,
            path: item.path,
            snippet: snippet(text, pos)
        });
        if (hits.length >= limit) break;
    }
    return hits;
}

function snippet(text, pos) {
    const start = Math.max(0, pos - 140);
    const end = Math.min(text.length, pos + 280);
    return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

export function getRpcMethod(input) {
    const name = String(input?.method ?? '')
        .trim()
        .toLowerCase();
    if (!name.includes('.')) throw new Error('method must be Namespace.Method');
    const [namespace, ...parts] = name.split('.');
    const method = parts.join('.');
    const inventory = readJson(RPC_INVENTORY_PATH);
    const rows = inventory.methods.filter(
        (row) =>
            row.namespace.toLowerCase() === namespace &&
            row.method.toLowerCase() === method
    );
    return {method: name, rows};
}

export function findFrontendCallers(input) {
    const method = String(input?.method ?? '')
        .trim()
        .toLowerCase();
    if (!method.includes('.'))
        throw new Error('method must be Namespace.Method');
    const deps = readJson(FRONTEND_DEPS_PATH);
    const calls = deps.calls.filter((call) =>
        String(call.method ?? '')
            .toLowerCase()
            .includes(method)
    );
    return {method, calls};
}

function toolDefinitions() {
    return [
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
            }
        },
        {
            name: 'get_rpc_method',
            description:
                'Look up a backend RPC method in the generated inventory.',
            inputSchema: {
                type: 'object',
                properties: {method: {type: 'string'}},
                required: ['method']
            }
        },
        {
            name: 'find_frontend_callers',
            description: 'Find frontend calls for a backend method.',
            inputSchema: {
                type: 'object',
                properties: {method: {type: 'string'}},
                required: ['method']
            }
        }
    ];
}

function toolResult(value) {
    return {
        content: [{type: 'text', text: JSON.stringify(value, null, 2)}]
    };
}

function callTool(name, args) {
    if (name === 'search_docs') return toolResult(searchDocs(args));
    if (name === 'get_rpc_method') return toolResult(getRpcMethod(args));
    if (name === 'find_frontend_callers') {
        return toolResult(findFrontendCallers(args));
    }
    throw new Error(`Unknown tool: ${name}`);
}

function response(id, result) {
    return {jsonrpc: '2.0', id, result};
}

function errorResponse(id, error) {
    return {
        jsonrpc: '2.0',
        id,
        error: {code: -32000, message: String(error?.message ?? error)}
    };
}

function handleRequest(message) {
    if (message.method === 'initialize') {
        return response(message.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {resources: {}, tools: {}},
            serverInfo: {name: SERVER_NAME, version: SERVER_VERSION}
        });
    }
    if (message.method === 'resources/list') {
        return response(message.id, {resources: listResources()});
    }
    if (message.method === 'resources/read') {
        const item = readResource(message.params?.uri);
        return response(message.id, {contents: [item]});
    }
    if (message.method === 'tools/list') {
        return response(message.id, {tools: toolDefinitions()});
    }
    if (message.method === 'tools/call') {
        return response(
            message.id,
            callTool(message.params?.name, message.params?.arguments ?? {})
        );
    }
    if (message.id === undefined) return null;
    throw new Error(`Unsupported MCP method: ${message.method}`);
}

function writeMessage(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

export async function runServer() {
    const input = readline.createInterface({
        input: process.stdin,
        crlfDelay: Number.POSITIVE_INFINITY
    });
    for await (const line of input) {
        if (!line.trim()) continue;
        let message;
        try {
            message = JSON.parse(line);
            const result = handleRequest(message);
            if (result) writeMessage(result);
        } catch (error) {
            writeMessage(errorResponse(message?.id ?? null, error));
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await runServer();
}
