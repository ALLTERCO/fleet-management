// OpenAPI 3.1 emitter — single-file customer-shareable contract.
// Source of truth: same _DESCRIBE registry as api-docs.ts.
// Each RPC method becomes POST /rpc/{Namespace}.{Method}; params -> requestBody,
// response -> responses.200. OpenAPI 3.1 uses JSON Schema 2020-12 natively, so
// the schemas drop in unchanged. Custom fields (unit, maxBytes) are x-fm-prefixed.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {DescribeOutput, MethodDescriptor} from '../../src/rpc/describe';
import type {JsonSchema} from '../../src/types/api/_schema';
import {loadAllDescribes} from './_describes.js';
import {GENERATED_DIR, relPath} from './_shared.js';
import {buildGuidesMarkdown} from './api-guides.js';

// Standard JSON Schema 2020-12 / OpenAPI 3.1 keys — anything else is custom.
const STANDARD_SCHEMA_KEYS = new Set([
    'type',
    'required',
    'properties',
    'items',
    'enum',
    'const',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'minProperties',
    'maxProperties',
    'additionalProperties',
    'anyOf',
    'oneOf',
    'allOf',
    'not',
    'default',
    'title',
    'description',
    'format',
    'pattern',
    'examples',
    'example',
    'readOnly',
    'writeOnly',
    'deprecated',
    '$ref'
]);

interface CodeSample {
    lang: string;
    label: string;
    source: string;
}

interface OpenApiOperation {
    operationId: string;
    summary: string;
    description: string;
    tags: string[];
    'x-fm-permission': Record<string, unknown>;
    'x-codeSamples': CodeSample[];
    requestBody?: {
        required: true;
        content: {'application/json': {schema: unknown}};
    };
    responses: Record<string, unknown>;
}

interface OpenApiDocument {
    openapi: '3.1.0';
    info: {
        title: string;
        version: string;
        description: string;
    };
    servers: Array<{url: string; description: string}>;
    tags: Array<{name: string; description?: string; 'x-kind'?: string}>;
    paths: Record<string, Record<'post', OpenApiOperation>>;
    components: {schemas: Record<string, unknown>};
}

// Convert a custom field name to its x-fm- extension form.
function toExtensionKey(name: string): string {
    const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    return `x-fm-${kebab.replace(/^-+/, '')}`;
}

// Recursively rewrite a JsonSchema into OpenAPI-clean form. Unknown extras
// move under x-fm-* extensions so strict validators don't choke.
function toOpenApiSchema(schema: JsonSchema): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
        if (value === undefined) continue;
        if (STANDARD_SCHEMA_KEYS.has(key)) {
            out[key] = rewriteValue(key, value);
        } else {
            out[toExtensionKey(key)] = value;
        }
    }
    return out;
}

function rewriteValue(key: string, value: unknown): unknown {
    if (value === null) return null;
    if (key === 'properties' && isPlainObject(value)) {
        const props: Record<string, unknown> = {};
        for (const [name, prop] of Object.entries(value)) {
            props[name] = toOpenApiSchema(prop as JsonSchema);
        }
        return props;
    }
    if (key === 'items' && isPlainObject(value)) {
        return toOpenApiSchema(value as JsonSchema);
    }
    if (
        key === 'additionalProperties' &&
        isPlainObject(value) &&
        !Array.isArray(value)
    ) {
        return toOpenApiSchema(value as JsonSchema);
    }
    if (
        (key === 'anyOf' || key === 'oneOf' || key === 'allOf') &&
        Array.isArray(value)
    ) {
        return value.map((v) => toOpenApiSchema(v as JsonSchema));
    }
    return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Code samples (JS/Python/wscat) — Scalar renders via x-codeSamples.
// {HOST} is rewritten at page-load time to window.location.host.

const SAMPLE_DEPTH_CAP = 6;
function exampleValue(schema: JsonSchema, depth = 0): unknown {
    if (depth > SAMPLE_DEPTH_CAP) return null;
    if (schema.const !== undefined) return schema.const;
    if (schema.enum?.length) return schema.enum[0];
    if (schema.default !== undefined) return schema.default;
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    if (type === 'string')
        return schema.format === 'date-time'
            ? '1970-01-01T00:00:00.000Z'
            : 'string';
    if (type === 'integer' || type === 'number') return schema.minimum ?? 0;
    if (type === 'boolean') return false;
    if (type === 'null') return null;
    if (type === 'array')
        return schema.items ? [exampleValue(schema.items, depth + 1)] : [];
    if (type !== 'object') return null;
    const obj: Record<string, unknown> = {};
    const required = new Set<string>(schema.required ?? []);
    if (schema.anyOf?.length) {
        const branchRequired = schema.anyOf
            .map((b) => b.required ?? [])
            .find((r) => r.length > 0);
        for (const k of branchRequired ?? []) required.add(k);
    }
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
        if (required.has(k)) obj[k] = exampleValue(v, depth + 1);
    }
    return obj;
}

function jsonRpcEnvelope(operationId: string, params: unknown): string {
    // Shelly-dialect JSON-RPC: src identifies the caller, dst routes the call
    // (FLEET_MANAGER for the server itself; a device id relays to that device).
    const frame = {
        jsonrpc: '2.0',
        id: 1,
        src: 'my-client',
        dst: 'FLEET_MANAGER',
        method: operationId,
        params
    };
    return JSON.stringify(frame, null, 2);
}

function sampleJs(operationId: string, params: unknown): string {
    const envelope = JSON.stringify(jsonRpcEnvelope(operationId, params));
    return [
        '// {HOST} is rewritten to your deployment when served at /api/docs.',
        '// The access token is passed as the WebSocket subprotocol.',
        "const ws = new WebSocket('wss://{HOST}/', token);",
        '',
        'ws.onopen = () => {',
        `  ws.send(${envelope});`,
        '};',
        '',
        'ws.onmessage = (evt) => {',
        '  const msg = JSON.parse(evt.data);',
        '  console.log(msg.result ?? msg.error);',
        '};'
    ].join('\n');
}

function samplePython(operationId: string, params: unknown): string {
    const frame = jsonRpcEnvelope(operationId, params);
    return [
        '# pip install websockets',
        'import asyncio, json, websockets',
        '',
        'async def call():',
        '    headers = {"Authorization": f"Bearer {TOKEN}"}',
        "    async with websockets.connect('wss://{HOST}/', additional_headers=headers) as ws:",
        `        await ws.send(json.dumps(${frame}))`,
        '        print(json.loads(await ws.recv()))',
        '',
        'asyncio.run(call())'
    ].join('\n');
}

function sampleShell(operationId: string, params: unknown): string {
    const frame = jsonRpcEnvelope(operationId, params).replace(/\n\s*/g, ' ');
    return [
        '# npm i -g wscat',
        `echo '${frame}' | wscat -c wss://{HOST}/ -H "Authorization: Bearer $TOKEN"`
    ].join('\n');
}

function buildCodeSamples(
    operationId: string,
    params: JsonSchema
): CodeSample[] {
    const exampleParams = exampleValue(params) ?? {};
    return [
        {
            lang: 'js',
            label: 'JavaScript',
            source: sampleJs(operationId, exampleParams)
        },
        {
            lang: 'python',
            label: 'Python',
            source: samplePython(operationId, exampleParams)
        },
        {
            lang: 'shell',
            label: 'wscat',
            source: sampleShell(operationId, exampleParams)
        }
    ];
}

function permissionSummary(method: MethodDescriptor): string {
    const p = method.permission;
    if (p.note) return p.note;
    const comp = p.component ?? 'n/a';
    const op = p.operation ?? 'n/a';
    return `${comp} / ${op}`;
}

function buildOperation(
    namespace: string,
    method: MethodDescriptor
): OpenApiOperation {
    const permission = permissionSummary(method);
    const descLines: string[] = [];
    if (method.description) descLines.push(method.description);
    descLines.push(`**Permission:** ${permission}`);
    const operationId = `${namespace}.${method.name}`;
    const op: OpenApiOperation = {
        operationId,
        summary: operationId,
        description: descLines.join('\n\n'),
        tags: [namespace],
        'x-fm-permission': {
            ...(method.permission.component
                ? {component: method.permission.component}
                : {}),
            ...(method.permission.operation
                ? {operation: method.permission.operation}
                : {}),
            ...(method.permission.note ? {note: method.permission.note} : {})
        },
        'x-codeSamples': buildCodeSamples(operationId, method.params),
        responses: {
            '200': {
                description: 'Success',
                content: {
                    'application/json': {
                        schema: toOpenApiSchema(method.response)
                    }
                }
            },
            '400': {description: 'Validation error'},
            '403': {description: 'Permission denied'}
        }
    };
    const paramsSchema = toOpenApiSchema(method.params);
    const hasParams =
        method.params.type !== undefined ||
        (method.params.properties &&
            Object.keys(method.params.properties).length > 0);
    if (hasParams) {
        op.requestBody = {
            required: true,
            content: {'application/json': {schema: paramsSchema}}
        };
    }
    return op;
}

// Lead paragraph for the OpenAPI intro. Handwritten guides
// (docs/api/guides/*.md) are appended after it — Scalar renders the combined
// markdown, turning each guide's headings into sidebar pages.
const SPEC_INTRO =
    'Fleet Manager exposes a JSON-RPC surface over WebSocket. ' +
    'Each operation below is reachable as a WebSocket RPC call; the ' +
    '`/rpc/{Namespace}.{Method}` URL exists for tooling — the contract ' +
    '(params, response, errors) is identical on either transport.';

function buildDocument(describes: DescribeOutput[]): OpenApiDocument {
    const paths: OpenApiDocument['paths'] = {};
    const tags: OpenApiDocument['tags'] = [];
    for (const ns of describes) {
        const tagDesc: string[] = [];
        if (ns.description) tagDesc.push(ns.description);
        if (ns.tags?.length) tagDesc.push(`Tags: ${ns.tags.join(', ')}`);
        tags.push({
            name: ns.namespace,
            ...(tagDesc.length ? {description: tagDesc.join('\n\n')} : {}),
            ...(ns.kind ? {'x-kind': ns.kind} : {})
        });
        for (const [methodName, method] of Object.entries(ns.methods)) {
            const route = `/rpc/${ns.namespace}.${methodName}`;
            paths[route] = {post: buildOperation(ns.namespace, method)};
        }
    }
    return {
        openapi: '3.1.0',
        info: {
            title: 'Fleet Manager API',
            version: '2.1',
            description: [SPEC_INTRO, buildGuidesMarkdown()]
                .filter(Boolean)
                .join('\n\n')
        },
        servers: [
            {
                url: 'wss://{host}/',
                description:
                    'WebSocket RPC endpoint (root path). Replace `{host}` with the deployment URL.'
            }
        ],
        tags,
        paths,
        components: {schemas: {}}
    };
}

export interface OpenApiGenerationResult {
    namespaces: number;
    methods: number;
    document: OpenApiDocument;
}

export async function generate(
    options: {write?: boolean} = {}
): Promise<OpenApiGenerationResult> {
    const describes = await loadAllDescribes();
    const document = buildDocument(describes);
    const methods = describes.reduce(
        (n, d) => n + Object.keys(d.methods).length,
        0
    );
    if (options.write !== false) {
        fs.mkdirSync(GENERATED_DIR, {recursive: true});
        const outPath = path.join(GENERATED_DIR, 'api.openapi.json');
        fs.writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
        console.log(`[api-openapi] wrote ${relPath(outPath)}`);
    }
    return {namespaces: describes.length, methods, document};
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void generate().then((r) => {
        console.log(
            '[api-openapi] %d namespaces, %d methods',
            r.namespaces,
            r.methods
        );
    });
}
