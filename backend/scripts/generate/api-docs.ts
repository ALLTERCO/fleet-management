/**
 * API documentation generator.
 *
 * Reads every `_DESCRIBE` manifest under `backend/src/types/api/*.ts` and
 * any handwritten prose under `docs/api/<namespace>.md`, then renders a
 * single end-user reference at `docs/generated/api.md`.
 *
 * - Each method gets a heading, description, permission note, params +
 *   response schemas rendered as tables, and a JSON example payload.
 * - Handwritten prose (if a `<!-- prose:<Method> -->` marker matches in
 *   `docs/api/<ns>.md`) is appended below the auto-generated reference
 *   block, so namespace owners can add examples without forking the
 *   manifest-driven structure.
 * - Coverage gate: any registered method missing prose lands with a
 *   `_(no additional notes — auto-generated reference only)_` footer
 *   and is counted in the run summary.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {DescribeOutput, MethodDescriptor} from '../../src/rpc/describe';
import type {JsonSchema} from '../../src/types/api/_schema';
import {DOCS_DIR, GENERATED_DIR, REPO_ROOT, relPath} from './_shared.js';

const PROSE_DIR = path.join(DOCS_DIR, 'api');
const TYPES_DIR = path.join(REPO_ROOT, 'backend/src/types/api');

interface NamespaceProse {
    intro?: string;
    methods: Map<string, string>;
}

function listDescribeFiles(): string[] {
    // Skip _helpers and the barrel index — both would re-introduce
    // duplicates (the index re-exports every namespace).
    return fs
        .readdirSync(TYPES_DIR)
        .filter(
            (f) => f.endsWith('.ts') && !f.startsWith('_') && f !== 'index.ts'
        )
        .map((f) => path.join(TYPES_DIR, f));
}

async function loadAllDescribes(): Promise<DescribeOutput[]> {
    const byNamespace = new Map<string, DescribeOutput>();
    for (const file of listDescribeFiles()) {
        const mod = (await import(file)) as Record<string, unknown>;
        for (const [key, value] of Object.entries(mod)) {
            if (!key.endsWith('_DESCRIBE')) continue;
            if (!value || typeof value !== 'object') continue;
            const candidate = value as DescribeOutput;
            if (
                typeof candidate.namespace !== 'string' ||
                !candidate.methods ||
                typeof candidate.methods !== 'object'
            ) {
                continue;
            }
            // Dedupe by namespace — each namespace may be re-exported
            // through helper files; keep the first occurrence so the
            // owning file wins. Warn when an unrelated file (different
            // object identity) collides — a typo or accidental clone.
            const existing = byNamespace.get(candidate.namespace);
            if (!existing) {
                byNamespace.set(candidate.namespace, candidate);
            } else if (existing !== candidate) {
                console.warn(
                    '[api-docs] duplicate namespace "%s" found in %s (already declared elsewhere) — keeping first',
                    candidate.namespace,
                    path.basename(file)
                );
            }
        }
    }
    return [...byNamespace.values()].sort((a, b) =>
        a.namespace.localeCompare(b.namespace)
    );
}

const PROSE_INTRO_MARKER = '<!-- prose:intro -->';
const PROSE_METHOD_MARKER_RE = /^<!--\s*prose:([A-Za-z0-9_.]+)\s*-->$/;
const PROSE_END_MARKER = '<!-- /prose -->';

function parseProseFile(filePath: string): NamespaceProse {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split('\n');
    const methods = new Map<string, string>();
    let intro: string | undefined;
    let buf: string[] = [];
    let current: string | 'intro' | undefined;
    let openedAt = 0;

    const flush = (closingTagLine: number | null) => {
        if (current === undefined) return;
        if (closingTagLine === null) {
            console.warn(
                '[api-docs] %s: prose block for "%s" opened at line %d has no <!-- /prose --> close tag; content swallowed to next marker',
                relPath(filePath),
                current,
                openedAt
            );
        }
        const body = buf.join('\n').trim();
        if (current === 'intro') {
            if (body) intro = body;
        } else if (body) {
            if (methods.has(current)) {
                console.warn(
                    '[api-docs] %s: duplicate prose block for "%s" at line %d — earlier block overwritten',
                    relPath(filePath),
                    current,
                    openedAt
                );
            }
            methods.set(current, body);
        }
        buf = [];
        current = undefined;
    };

    let lineNo = 0;
    for (const line of lines) {
        lineNo++;
        if (line.trim() === PROSE_INTRO_MARKER) {
            flush(current === undefined ? null : null);
            current = 'intro';
            openedAt = lineNo;
            continue;
        }
        if (line.trim() === PROSE_END_MARKER) {
            flush(lineNo);
            continue;
        }
        const m = PROSE_METHOD_MARKER_RE.exec(line.trim());
        if (m) {
            flush(current === undefined ? null : null);
            current = m[1];
            openedAt = lineNo;
            continue;
        }
        if (current !== undefined) buf.push(line);
    }
    // EOF flush — if we were inside a block, it wasn't closed cleanly.
    flush(current === undefined ? null : null);
    return {intro, methods};
}

function loadAllProse(): Map<string, NamespaceProse> {
    const out = new Map<string, NamespaceProse>();
    if (!fs.existsSync(PROSE_DIR)) return out;
    for (const f of fs.readdirSync(PROSE_DIR)) {
        if (!f.endsWith('.md')) continue;
        // _overview.md is a special intro file — whole-file content
        // becomes the document intro, no markers needed. Other
        // underscore-prefixed files are auxiliary and skipped.
        if (f === '_overview.md') {
            const text = fs.readFileSync(path.join(PROSE_DIR, f), 'utf8');
            out.set('_overview', {intro: text.trim(), methods: new Map()});
            continue;
        }
        if (f.startsWith('_')) continue;
        const ns = f.slice(0, -3);
        out.set(ns, parseProseFile(path.join(PROSE_DIR, f)));
    }
    return out;
}

// --- Schema rendering ----------------------------------------------------

const MAX_SCHEMA_DEPTH = 8;

// Schemas often use `type: ['object', 'null']` to mark an optional
// nested struct. Anywhere we'd treat `type === 'object'` we must also
// treat that union as object-shape, otherwise the table collapses to
// an opaque `object` row instead of recursing into properties.
function isObjectShape(schema: JsonSchema): boolean {
    const t = schema.type;
    if (Array.isArray(t)) return t.includes('object');
    return t === 'object';
}

// Returns a plain type label with raw `|` separators. Table cell escaping
// is handled exactly once by escapeTableCell when the label lands in a row.
// Wrapping a returned label in a code span (`` `...` ``) before splicing
// into Markdown is the caller's job — `<` / `>` are kept literal here so
// the label is reusable in code spans, plain text, and JSON examples.
function typeLabel(schema: JsonSchema): string {
    if (schema.enum) {
        const vals = schema.enum.map((v) => JSON.stringify(v)).join(' | ');
        return `enum(${vals})`;
    }
    if (schema.const !== undefined) {
        return `const(${JSON.stringify(schema.const)})`;
    }
    if (schema.anyOf?.length) {
        return schema.anyOf.map(typeLabel).join(' | ');
    }
    const t = schema.type;
    if (Array.isArray(t)) return t.join(' | ');
    if (t === 'array') {
        return `array<${schema.items ? typeLabel(schema.items) : 'any'}>`;
    }
    if (t === 'object') {
        if (schema.properties) return 'object';
        if (schema.additionalProperties === true) return 'object<any>';
        if (
            schema.additionalProperties &&
            typeof schema.additionalProperties === 'object'
        ) {
            return `object<${typeLabel(schema.additionalProperties)}>`;
        }
        return 'object';
    }
    return t ?? 'any';
}

function constraintNote(schema: JsonSchema): string {
    const parts: string[] = [];
    if (schema.minimum !== undefined) parts.push(`min ${schema.minimum}`);
    if (schema.maximum !== undefined) parts.push(`max ${schema.maximum}`);
    if (schema.minLength !== undefined)
        parts.push(`minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined)
        parts.push(`maxLength ${schema.maxLength}`);
    if (schema.minItems !== undefined)
        parts.push(`minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined)
        parts.push(`maxItems ${schema.maxItems}`);
    if (schema.maxBytes !== undefined)
        parts.push(`≤ ${schema.maxBytes} B JSON`);
    if (schema.unit) parts.push(`unit: ${schema.unit}`);
    return parts.join(', ');
}

function escapeTableCell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

// Field path joiner — top-level `userId`, nested `scope.deviceIds[]`.
function joinPath(prefix: string, leaf: string): string {
    return prefix ? `${prefix}.${leaf}` : leaf;
}

// Recurse into a schema, emitting one row per leaf (including nested
// object fields). Array-of-object items get exploded under `<path>[]`.
// MAX_SCHEMA_DEPTH guards against runaway recursion if a future schema
// is built with self-reference.
function collectPropRows(
    schema: JsonSchema,
    pathPrefix: string,
    parentRequired: Set<string>,
    leafName: string | undefined,
    depth: number,
    rows: string[]
): void {
    if (depth > MAX_SCHEMA_DEPTH) {
        if (leafName !== undefined) {
            rows.push(
                `| \`${joinPath(pathPrefix, leafName)}\` | (depth limit) | ${parentRequired.has(leafName) ? 'yes' : 'no'} |  | … |`
            );
        }
        return;
    }
    const fullPath = leafName ? joinPath(pathPrefix, leafName) : pathPrefix;
    const req = leafName ? (parentRequired.has(leafName) ? 'yes' : 'no') : '—';
    const def =
        schema.default !== undefined
            ? `\`${JSON.stringify(schema.default)}\``
            : '';
    const constraints = constraintNote(schema);
    const desc = [schema.description, constraints].filter(Boolean).join(' — ');
    const label = `\`${typeLabel(schema)}\``;
    if (leafName !== undefined) {
        rows.push(
            `| \`${fullPath}\` | ${escapeTableCell(label)} | ${req} | ${def} | ${escapeTableCell(desc)} |`
        );
    }

    // Recurse — object: each property; array<object>: array items.
    const typesArr = Array.isArray(schema.type)
        ? schema.type
        : schema.type !== undefined
          ? [schema.type]
          : [];
    const isArrayShape = typesArr.includes('array');
    if (isObjectShape(schema) && schema.properties) {
        const childRequired = new Set(schema.required ?? []);
        for (const [name, prop] of Object.entries(schema.properties)) {
            collectPropRows(
                prop,
                fullPath,
                childRequired,
                name,
                depth + 1,
                rows
            );
        }
    } else if (isArrayShape && schema.items && schema.items.type === 'object') {
        collectPropRows(
            schema.items,
            `${fullPath}[]`,
            new Set(schema.items.required ?? []),
            undefined,
            depth + 1,
            rows
        );
    }
}

function renderObjectProps(schema: JsonSchema): string {
    if (!isObjectShape(schema)) return '';
    const rows: string[] = [];
    rows.push('| Field | Type | Required | Default | Description |');
    rows.push('|-------|------|----------|---------|-------------|');
    const required = new Set(schema.required ?? []);
    if (schema.properties) {
        for (const [name, prop] of Object.entries(schema.properties)) {
            collectPropRows(prop, '', required, name, 0, rows);
        }
    }
    // Open-shape object: additionalProperties is a schema (typed map) or
    // boolean. Document it as a footnote row so the consumer knows the
    // shape isn't strict.
    if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === 'object'
    ) {
        rows.push(
            `| \`<additional>\` | ${escapeTableCell(`\`${typeLabel(schema.additionalProperties)}\``)} | no |  | Additional unspecified keys accepted with this value shape. |`
        );
    } else if (schema.additionalProperties === true) {
        rows.push(
            '| `<additional>` | `any` | no |  | Additional unspecified keys are accepted with any value. |'
        );
    }
    // Object-level anyOf — most commonly used to express "at least one
    // of these keys is required". Surface it so the table doesn't
    // contradict the dispatcher.
    let table = rows.join('\n');
    if (schema.anyOf?.length) {
        const summary = schema.anyOf
            .map((branch) => {
                const r = branch.required ?? [];
                return r.length ? `[${r.join(', ')}]` : typeLabel(branch);
            })
            .join(' or ');
        table = `${table}\n\n**Constraint**: must satisfy at least one of ${summary}.`;
    }
    return table;
}

// Best-effort example value for a schema — used to seed example payloads
// when the prose file doesn't supply one. Depth-capped so a future
// self-referential schema can't bomb the generator.
function exampleFromSchema(schema: JsonSchema, depth = 0): unknown {
    if (depth > MAX_SCHEMA_DEPTH) return null;
    if (schema.const !== undefined) return schema.const;
    if (schema.enum?.length) return schema.enum[0];
    if (schema.default !== undefined) return schema.default;
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    switch (type) {
        case 'string':
            // Sentinel — must be a constant so regen is deterministic.
            return schema.format === 'date-time'
                ? '1970-01-01T00:00:00.000Z'
                : 'string';
        case 'integer':
            return schema.minimum ?? 0;
        case 'number':
            return schema.minimum ?? 0;
        case 'boolean':
            return false;
        case 'array':
            return schema.items
                ? [exampleFromSchema(schema.items, depth + 1)]
                : [];
        case 'null':
            return null;
        case 'object': {
            const obj: Record<string, unknown> = {};
            // Honour the top-level `required` set, plus the first branch
            // of any object-level `anyOf` (commonly used to express
            // "at least one of [a, b]") — without this the auto-example
            // would fail the dispatcher's validation.
            const required = new Set<string>(schema.required ?? []);
            if (schema.anyOf?.length) {
                const firstBranchRequired = schema.anyOf
                    .map((b) => b.required ?? [])
                    .find((r) => r.length > 0);
                for (const k of firstBranchRequired ?? []) required.add(k);
            }
            for (const [k, v] of Object.entries(schema.properties ?? {})) {
                if (required.has(k)) obj[k] = exampleFromSchema(v, depth + 1);
            }
            return obj;
        }
        default:
            return null;
    }
}

function renderExample(label: string, schema: JsonSchema): string {
    const sample = exampleFromSchema(schema);
    return [
        `**${label} example:**`,
        '',
        '```json',
        JSON.stringify(sample, null, 2),
        '```'
    ].join('\n');
}

// --- Method rendering ----------------------------------------------------

// Stable deep-link slug — namespace + method, lowercased, dots/dashes
// flattened. Renderers that auto-slug headings would produce something
// less predictable for `<code>` markup, so we emit an HTML anchor too.
function methodAnchor(namespace: string, methodName: string): string {
    return `${namespace}-${methodName}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function renderMethod(
    namespace: string,
    method: MethodDescriptor,
    prose: string | undefined,
    sectionLevel: number
): string {
    const hashes = '#'.repeat(sectionLevel);
    const out: string[] = [];
    out.push(`<a id="${methodAnchor(namespace, method.name)}"></a>`);
    out.push(`${hashes} \`${namespace}.${method.name}\``);
    out.push('');
    if (method.description) {
        out.push(method.description);
        out.push('');
    }
    out.push(
        `**Permission**: ${method.permission.note ?? `${method.permission.component ?? 'n/a'} / ${method.permission.operation ?? 'n/a'}`}`
    );
    out.push('');

    if (isObjectShape(method.params) && method.params.properties) {
        out.push(`${hashes}# Params`);
        out.push('');
        out.push(renderObjectProps(method.params));
        out.push('');
        out.push(renderExample('Params', method.params));
        out.push('');
    } else {
        out.push(`${hashes}# Params`);
        out.push('');
        out.push(`Type: \`${typeLabel(method.params)}\``);
        out.push('');
    }

    if (isObjectShape(method.response) && method.response.properties) {
        out.push(`${hashes}# Response`);
        out.push('');
        out.push(renderObjectProps(method.response));
        out.push('');
        out.push(renderExample('Response', method.response));
        out.push('');
    } else if (method.response.type) {
        out.push(`${hashes}# Response`);
        out.push('');
        out.push(`Type: \`${typeLabel(method.response)}\``);
        out.push('');
    }

    if (prose) {
        out.push(`${hashes}# Notes`);
        out.push('');
        out.push(prose);
        out.push('');
    }
    return out.join('\n');
}

// --- Namespace + full doc rendering --------------------------------------

function methodNames(out: DescribeOutput): string[] {
    return Object.keys(out.methods).sort();
}

function renderNamespace(
    out: DescribeOutput,
    prose: NamespaceProse | undefined
): {body: string; missing: string[]} {
    const lines: string[] = [];
    // Explicit HTML anchor so cross-doc links resolve regardless of
    // renderer-specific slug rules (GFM lowercases + strips backticks;
    // mdBook differs; we pin the slug ourselves).
    lines.push(`<a id="${out.namespace}-namespace"></a>`);
    lines.push(`## \`${out.namespace}\` namespace`);
    lines.push('');
    if (prose?.intro) {
        lines.push(prose.intro);
        lines.push('');
    }
    if (out.tags?.length) {
        lines.push(`**Tags:** ${out.tags.map((t) => `\`${t}\``).join(', ')}`);
        lines.push('');
    }
    const missing: string[] = [];
    for (const name of methodNames(out)) {
        const method = out.methods[name];
        const sectionProse = prose?.methods.get(name);
        if (!sectionProse) missing.push(name);
        lines.push(renderMethod(out.namespace, method, sectionProse, 3));
    }
    if (out.errors?.length) {
        lines.push('### Error kinds');
        lines.push('');
        lines.push('| Kind | Code | Message |');
        lines.push('|------|------|---------|');
        for (const e of out.errors) {
            const e2 = e as {kind: string; code?: number; message?: string};
            lines.push(
                `| \`${e2.kind}\` | ${e2.code ?? ''} | ${escapeTableCell(e2.message ?? '')} |`
            );
        }
        lines.push('');
    }
    return {body: lines.join('\n'), missing};
}

function buildToc(describes: DescribeOutput[]): string {
    const lines: string[] = ['## Contents', ''];
    for (const d of describes) {
        const methods = methodNames(d);
        lines.push(
            `- [\`${d.namespace}\`](#${d.namespace}-namespace) — ${methods.length} method(s)`
        );
    }
    lines.push('');
    return lines.join('\n');
}

// --- Public API ----------------------------------------------------------

export interface ApiDocGenerationResult {
    totalNamespaces: number;
    totalMethods: number;
    namespacesWithProse: number;
    methodsWithProse: number;
    missingProse: {namespace: string; methods: string[]}[];
    markdown: string;
}

export async function generate(
    options: {write?: boolean} = {}
): Promise<ApiDocGenerationResult> {
    const describes = await loadAllDescribes();
    const prose = loadAllProse();

    const sections: string[] = [];
    let totalMethods = 0;
    let methodsWithProse = 0;
    let namespacesWithProse = 0;
    const missing: {namespace: string; methods: string[]}[] = [];

    for (const d of describes) {
        const p = prose.get(d.namespace);
        if (p) namespacesWithProse++;
        totalMethods += methodNames(d).length;
        if (p) methodsWithProse += p.methods.size;
        const rendered = renderNamespace(d, p);
        sections.push(rendered.body);
        if (rendered.missing.length > 0) {
            missing.push({namespace: d.namespace, methods: rendered.missing});
        }
    }

    // Customer-facing; provenance lives in api.provenance.json sidecar.
    const header = '# Fleet Manager — API Reference\n\n';
    const intro = prose.get('_overview')?.intro;

    const introBlock = intro ? `${intro}\n\n---\n\n` : '';
    const toc = buildToc(describes);
    const body = sections.join('\n\n---\n\n');

    const fullMd = `${header}\n${introBlock}${toc}\n---\n\n${body}\n`;
    if (options.write !== false) {
        fs.mkdirSync(GENERATED_DIR, {recursive: true});
        fs.writeFileSync(path.join(GENERATED_DIR, 'api.md'), fullMd);
        const sidecar = {
            generatedBy: 'backend/scripts/generate/api-docs.ts',
            sources: [
                'backend/src/types/api/*.ts',
                'docs/api/*.md (handwritten prose)'
            ],
            namespaceCount: describes.length,
            methodCount: describes.reduce(
                (n, d) => n + Object.keys(d.methods).length,
                0
            )
        };
        fs.writeFileSync(
            path.join(GENERATED_DIR, 'api.provenance.json'),
            `${JSON.stringify(sidecar, null, 4)}\n`
        );
        console.log(
            `[api-docs] wrote ${relPath(path.join(GENERATED_DIR, 'api.md'))}`
        );
    }

    return {
        totalNamespaces: describes.length,
        totalMethods,
        namespacesWithProse,
        methodsWithProse,
        missingProse: missing,
        markdown: fullMd
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void generate().then((r) => {
        console.log(
            '[api-docs] %d namespaces, %d methods (%d with prose)',
            r.totalNamespaces,
            r.totalMethods,
            r.methodsWithProse
        );
        if (r.missingProse.length > 0) {
            const total = r.missingProse.reduce(
                (acc, m) => acc + m.methods.length,
                0
            );
            console.log(
                '[api-docs] %d method(s) without prose — auto-generated reference only',
                total
            );
        }
    });
}
