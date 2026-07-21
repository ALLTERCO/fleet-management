/**
 * Documentation drift report generator (Phase 0a).
 *
 * Reads the RPC, HTTP, and event inventories, then checks priority contracts
 * against stable handwritten docs. Generated API docs remain the exhaustive
 * source for every method and route.
 *
 * Does NOT judge whether the docs are *correct* — only whether focused
 * contracts are mentioned where humans and agents expect them.
 *
 * Output: docs/generated/doc-drift-report.md (no JSON — this is purely a
 * reader-oriented report).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    DOCS_DIR,
    GENERATED_DIR,
    provenanceHeader,
    readFile
} from './_shared.js';
import {generate as genEvents} from './backend-event-inventory.js';
import {generate as genHttp} from './backend-http-inventory.js';
import {generate as genRpc} from './backend-rpc-inventory.js';

// Hand-written canonical docs only — docs/generated/api.md is itself
// auto-derived from the manifest, so scanning it for missing RPCs is
// tautological and hides drift in the human-prose set.
const CANONICAL_DOCS = [
    'docs/architecture/api.md',
    'docs/architecture/rpc-layers.md',
    'docs/architecture/virtual-devices.md',
    'docs/architecture/virtual-device-model.md',
    'docs/architecture/workflows/blu-bthome-promotion.md',
    'docs/architecture/workflows/composed-device-creation.md',
    'docs/reference/ai-and-mcp.md',
    'docs/reference/entities.md',
    'docs/reference/events.md',
    'docs/reference/node-red.md',
    'docs/reference/provisioning.md'
];

const FOCUSED_RPC_METHODS = new Set([
    'bthome.device.rename',
    'bthome.listgateways',
    'device.delete',
    'device.relationships.get',
    'device.relationships.query',
    'device.setimage',
    'device.setkind',
    'virtualdevice.binding.create',
    'virtualdevice.binding.list',
    'virtualdevice.binding.listsources',
    'virtualdevice.binding.validatedraft',
    'virtualdevice.bluetooth.candidate.list',
    'virtualdevice.bluetooth.delete',
    'virtualdevice.bluetooth.get',
    'virtualdevice.bluetooth.image.createuploadticket',
    'virtualdevice.bluetooth.list',
    'virtualdevice.bluetooth.promotefromgateway',
    'virtualdevice.bluetooth.transport.list',
    'virtualdevice.bluetooth.update',
    'virtualdevice.create',
    'virtualdevice.delete',
    'virtualdevice.get',
    'virtualdevice.image.createuploadticket',
    'virtualdevice.list',
    'virtualdevice.update'
]);

const FOCUSED_HTTP_ROUTES = new Set([
    'get /openapi.json',
    'get /rpc/:method',
    'post /rpc',
    'post /rpc/:method',
    'get /assets/:id',
    'post /uploads/asset'
]);

const FOCUSED_EVENTS = new Set([
    'bthome.controllearning',
    'bthome.controlsupdated',
    'bthome.discoverydone',
    'bthome.discoveryresult',
    'device.relationshipschanged'
]);

type Verdict = 'match' | 'missing doc';

interface DriftRow {
    contract: string;
    kind: 'rpc' | 'http' | 'event';
    verdict: Verdict;
    foundIn: string[];
}

interface InventoryTotals {
    rpc: number;
    http: number;
    event: number;
}

function loadDocs(): Map<string, string> {
    const out = new Map<string, string>();
    for (const rel of CANONICAL_DOCS) {
        const full = path.join(DOCS_DIR, '..', rel);
        if (fs.existsSync(full)) {
            out.set(rel, readFile(full));
        }
    }
    return out;
}

function isMentioned(docs: Map<string, string>, needle: string): string[] {
    const hits: string[] = [];
    const needleLower = needle.toLowerCase();
    for (const [file, text] of docs) {
        if (text.toLowerCase().includes(needleLower)) hits.push(file);
    }
    return hits;
}

function rpcName(method: {namespace: string; method: string}): string {
    return `${method.namespace}.${method.method}`;
}

function normalized(value: string): string {
    return value.toLowerCase();
}

function isFocusedRpc(method: {namespace: string; method: string}): boolean {
    const name = normalized(rpcName(method));
    return FOCUSED_RPC_METHODS.has(name);
}

function routeName(route: {
    method: string;
    mount?: string;
    path: string;
}): string {
    return `${route.method} ${(route.mount ?? '') + route.path}`;
}

function isFocusedHttpRoute(route: {
    method: string;
    mount?: string;
    path: string;
}): boolean {
    return FOCUSED_HTTP_ROUTES.has(normalized(routeName(route)));
}

function isFocusedEvent(eventName: string): boolean {
    return FOCUSED_EVENTS.has(normalized(eventName));
}

function focusedCoverage(rows: DriftRow[], kind: DriftRow['kind']) {
    const list = rows.filter((row) => row.kind === kind);
    return {
        total: list.length,
        match: list.filter((row) => row.verdict === 'match').length,
        missing: list.filter((row) => row.verdict === 'missing doc').length
    };
}

function inventoryTotals(input: {
    rpc: ReturnType<typeof genRpc>;
    http: ReturnType<typeof genHttp>;
    events: ReturnType<typeof genEvents>;
}): InventoryTotals {
    return {
        rpc: input.rpc.methods.filter(
            (m) => m.kind === 'explicit' && m.method !== 'Describe'
        ).length,
        http: input.http.routes.length,
        event: input.events.events.length
    };
}

export function generate(): string {
    const rpc = genRpc();
    const http = genHttp();
    const events = genEvents();
    const docs = loadDocs();
    const allTotals = inventoryTotals({rpc, http, events});

    const rows: DriftRow[] = [];

    // Focused RPC methods only. The generated OpenAPI and inventory are exhaustive.
    for (const m of rpc.methods) {
        if (m.kind !== 'explicit') continue;
        if (m.method === 'Describe') continue;
        if (!isFocusedRpc(m)) continue;
        const needle1 = rpcName(m);
        const needle2 = normalized(needle1);
        const hits = [
            ...new Set([
                ...isMentioned(docs, needle1),
                ...isMentioned(docs, needle2)
            ])
        ];
        rows.push({
            contract: needle1,
            kind: 'rpc',
            verdict: hits.length ? 'match' : 'missing doc',
            foundIn: hits
        });
    }

    for (const r of http.routes) {
        if (!isFocusedHttpRoute(r)) continue;
        const contract = routeName(r);
        const hits = isMentioned(docs, (r.mount ?? '') + r.path);
        rows.push({
            contract,
            kind: 'http',
            verdict: hits.length ? 'match' : 'missing doc',
            foundIn: hits
        });
    }

    for (const e of events.events) {
        if (!isFocusedEvent(e.eventName)) continue;
        const hits = isMentioned(docs, e.eventName);
        rows.push({
            contract: e.eventName,
            kind: 'event',
            verdict: hits.length ? 'match' : 'missing doc',
            foundIn: hits
        });
    }

    rows.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.verdict !== b.verdict) return a.verdict.localeCompare(b.verdict);
        return a.contract.localeCompare(b.contract);
    });

    const totals = {
        total: rows.length,
        match: rows.filter((r) => r.verdict === 'match').length,
        missing: rows.filter((r) => r.verdict === 'missing doc').length,
        byKind: {
            rpc: focusedCoverage(rows, 'rpc'),
            http: focusedCoverage(rows, 'http'),
            event: focusedCoverage(rows, 'event')
        },
        inventory: allTotals
    };

    const header = provenanceHeader('Documentation Drift Report', [
        ...CANONICAL_DOCS,
        'docs/generated/backend-rpc-inventory.json',
        'docs/generated/backend-http-inventory.json',
        'docs/generated/backend-event-inventory.json'
    ]);

    const summary = [
        '## Summary',
        '',
        `- Focused contracts checked: **${totals.total}**`,
        `- Documented (match): **${totals.match}**`,
        `- Missing doc mention: **${totals.missing}**`,
        `- Focused breakdown: ${totals.byKind.rpc.total} RPC + ${totals.byKind.http.total} HTTP + ${totals.byKind.event.total} events`,
        `- Full generated inventory: ${totals.inventory.rpc} RPC + ${totals.inventory.http} HTTP + ${totals.inventory.event} events`,
        '',
        '> This is a focused priority report, not an exhaustive contract list.',
        '> Use `docs/generated/api.openapi.json` and the generated inventories',
        '> for complete API coverage.',
        '',
        '> "Match" means the contract name appears verbatim in at least one stable doc file.',
        '',
        `Canonical docs scanned: ${CANONICAL_DOCS.map((d) => `\`${d}\``).join(', ')}`,
        ''
    ].join('\n');

    const sections: string[] = [];
    for (const kind of ['rpc', 'http', 'event'] as const) {
        const list = rows.filter((r) => r.kind === kind);
        const missing = list.filter((r) => r.verdict === 'missing doc');
        sections.push(
            `## ${kind.toUpperCase()} — ${missing.length} missing / ${list.length} focused`
        );
        sections.push('');
        if (missing.length === 0) {
            sections.push('All contracts documented.');
            sections.push('');
            continue;
        }
        sections.push('| Contract | Documented in |');
        sections.push('|---|---|');
        for (const r of list) {
            sections.push(
                `| \`${r.contract}\` | ${r.verdict === 'match' ? r.foundIn.map((f) => `\`${f}\``).join(', ') : '**missing**'} |`
            );
        }
        sections.push('');
    }

    return [header, summary, sections.join('\n')].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const md = generate();
    fs.mkdirSync(GENERATED_DIR, {recursive: true});
    const out = path.join(GENERATED_DIR, 'doc-drift-report.md');
    fs.writeFileSync(out, md);
    console.log(
        `[doc-drift-report] wrote ${path.relative(process.cwd(), out)}`
    );
}
