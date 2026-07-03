// Generates the typed Host SDK contract from the live _DESCRIBE surface.

import {spawnSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {DescribeOutput, MethodDescriptor} from '../../src/rpc/describe';
import {loadAllDescribes} from './_describes.js';
import {BACKEND_ROOT, FRONTEND_SRC, relPath} from './_shared.js';
import {NAMESPACE_GUIDE} from './host-namespace-guide.js';

const OUT_FILE = path.join(
    FRONTEND_SRC,
    'shell/template-host/generated/contract.ts'
);

type Schema = Record<string, unknown>;

function asSchema(value: unknown): Schema | null {
    return value && typeof value === 'object' ? (value as Schema) : null;
}

function isIdentifier(key: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(key);
}

function tsKey(key: string): string {
    return isIdentifier(key) ? key : `'${key.replace(/'/g, "\\'")}'`;
}

function literal(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') {
        return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }
    return String(value);
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

function primitiveTs(type: string): string {
    switch (type) {
        case 'string':
            return 'string';
        case 'integer':
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'null':
            return 'null';
        case 'array':
            return 'unknown[]';
        case 'object':
            return 'Record<string, unknown>';
        default:
            return 'unknown';
    }
}

function objectTs(schema: Schema): string {
    const props = asSchema(schema.properties) ?? {};
    const keys = Object.keys(props);
    const additional = schema.additionalProperties;
    if (keys.length === 0) {
        const apSchema = asSchema(additional);
        if (apSchema) return `Record<string, ${schemaToTs(apSchema)}>`;
        if (additional === false) return 'Record<string, never>';
        return 'Record<string, unknown>';
    }
    const required = new Set(
        Array.isArray(schema.required) ? (schema.required as string[]) : []
    );
    const lines = keys.map((key) => {
        const optional = required.has(key) ? '' : '?';
        return `${tsKey(key)}${optional}: ${schemaToTs(props[key])};`;
    });
    if (additional === true) {
        lines.push('[key: string]: unknown;');
    } else {
        const apSchema = asSchema(additional);
        if (apSchema) lines.push(`[key: string]: ${schemaToTs(apSchema)};`);
    }
    return `{${lines.join(' ')}}`;
}

function arrayTs(schema: Schema): string {
    const items = asSchema(schema.items);
    const itemTs = items ? schemaToTs(items) : 'unknown';
    return /[ |&]/.test(itemTs) ? `Array<${itemTs}>` : `${itemTs}[]`;
}

// JSON-Schema (the Draft-7 subset Describe uses) -> TS type string.
export function schemaToTs(input: unknown): string {
    const schema = asSchema(input);
    if (!schema) return 'unknown';
    if ('const' in schema) return literal(schema.const);
    if (Array.isArray(schema.enum)) {
        const members = unique(schema.enum.map(literal));
        return members.length ? members.join(' | ') : 'never';
    }
    for (const combinator of ['anyOf', 'oneOf'] as const) {
        const branches = schema[combinator];
        if (Array.isArray(branches)) {
            return unique(branches.map(schemaToTs)).join(' | ');
        }
    }
    if (Array.isArray(schema.allOf)) {
        return schema.allOf.map(schemaToTs).join(' & ');
    }
    const type = schema.type;
    if (Array.isArray(type)) {
        const members = type.map((t) => {
            if (t === 'object') return objectTs(schema);
            if (t === 'array') return arrayTs(schema);
            return primitiveTs(String(t));
        });
        return unique(members).join(' | ');
    }
    if (type === 'object') return objectTs(schema);
    if (type === 'array') return arrayTs(schema);
    if (typeof type === 'string') return primitiveTs(type);
    return 'unknown';
}

function jsDoc(method: MethodDescriptor): string {
    if (!method.description) return '';
    const text = method.description.replace(/\*\//g, '*\\/');
    return `/** ${text} */\n`;
}

function renderEntry(namespace: string, method: MethodDescriptor): string {
    const key = `${namespace}.${method.name}`.toLowerCase();
    const params = method.params ? schemaToTs(method.params) : 'never';
    const result = method.response ? schemaToTs(method.response) : 'unknown';
    return (
        `${jsDoc(method)}'${key}': {` +
        `params: ${params}; result: ${result};};`
    );
}

function renderGuide(): string {
    const seen = NAMESPACE_GUIDE;
    return `export const HOST_NAMESPACE_GUIDE: Record<
    string,
    HostNamespaceGuide
> = ${JSON.stringify(seen, null, 4)} as const;`;
}

function render(describes: DescribeOutput[]): string {
    const entries: string[] = [];
    for (const describe of describes) {
        for (const method of Object.values(describe.methods)) {
            entries.push(renderEntry(describe.namespace, method));
        }
    }
    return [
        '// AUTO-GENERATED — do not edit by hand.',
        '// Source: backend/src/types/api/*.ts (_DESCRIBE) + host-namespace-guide.ts',
        '// Regenerate: cd backend && npm run generate',
        '',
        'export interface HostContract {',
        entries.join('\n'),
        '}',
        '',
        'export type HostMethod = keyof HostContract;',
        '',
        "export type HostParams<M extends HostMethod> = HostContract[M]['params'];",
        '',
        "export type HostResult<M extends HostMethod> = HostContract[M]['result'];",
        '',
        'export interface HostNamespaceGuide {',
        '    purpose: string;',
        '    useInstead?: string;',
        '}',
        '',
        renderGuide(),
        ''
    ].join('\n');
}

// Format generated output with biome so re-runs are byte-stable. Fail loud.
function formatWithBiome(file: string): void {
    const biome = path.join(BACKEND_ROOT, 'node_modules/.bin/biome');
    const result = spawnSync(biome, ['check', '--write', file], {
        stdio: 'inherit'
    });
    if (result.status !== 0) {
        throw new Error(
            `biome failed to format ${relPath(file)} (status ${result.status})`
        );
    }
}

export async function generate(): Promise<{
    namespaces: number;
    methods: number;
}> {
    const describes = await loadAllDescribes();
    fs.mkdirSync(path.dirname(OUT_FILE), {recursive: true});
    fs.writeFileSync(OUT_FILE, render(describes));
    formatWithBiome(OUT_FILE);
    const methods = describes.reduce(
        (n, d) => n + Object.keys(d.methods).length,
        0
    );
    console.log(
        '[host-contract] %d namespaces, %d methods -> %s',
        describes.length,
        methods,
        relPath(OUT_FILE)
    );
    return {namespaces: describes.length, methods};
}

if (import.meta.url === `file://${process.argv[1]}`) {
    generate();
}
