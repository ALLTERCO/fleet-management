/**
 * Transport / auth matrix generator (Phase 0a).
 *
 * Cross-cuts the previously-generated inventories (RPC + HTTP + WS) into a
 * single view answering: "for every backend surface, what authorization
 * model applies?"
 *
 * Buckets:
 *   - CRUD permission decorator (@Component.CrudPermission)
 *   - Fine-grained decorator (@Component.CheckPermissions)
 *   - Implicit/legacy fallback (inherited checkPermissions via mapLegacyComponentName)
 *   - HTTP isLoggedIn middleware
 *   - HTTP requiresAdmin middleware
 *   - HTTP route-permission (hasApiPermission / validateDeviceAccess)
 *   - Public / unauthenticated
 *
 * Output: docs/generated/transport-auth-matrix.{json,md}
 */

import {mdEscape, provenanceHeader, writeOutputs} from './_shared.js';
import {generate as genHttp} from './backend-http-inventory.js';
import {generate as genRpc} from './backend-rpc-inventory.js';
import {generate as genWs} from './backend-ws-inventory.js';

export type AuthBucket =
    | 'crud-decorator'
    | 'fine-grained-decorator'
    | 'legacy-fallback'
    | 'public'
    | 'http-logged-in'
    | 'http-admin'
    | 'http-platform-admin'
    | 'http-observability'
    | 'http-permission'
    | 'http-audit-view'
    | 'http-route-permission'
    | 'http-unknown'
    | 'ws-authenticated'
    | 'ws-unauthenticated';

export interface AuthRow {
    transport: 'rpc' | 'http' | 'ws';
    surface: string;
    authBucket: AuthBucket;
    detail: string;
    sourceFile: string;
    sourceLine: number;
}

export interface AuthMatrix {
    generator: 'transport-auth-matrix';
    version: 1;
    totals: {
        rows: number;
        byBucket: Record<string, number>;
    };
    rows: AuthRow[];
}

function rpcBucket(permission: string): AuthBucket {
    if (permission === 'CrudPermission') return 'crud-decorator';
    if (permission === 'CheckPermissions') return 'fine-grained-decorator';
    if (
        permission === 'NoPermissions' ||
        permission === 'ReadOnly' ||
        permission === 'WriteOperation'
    ) {
        return permission === 'NoPermissions' ? 'public' : 'legacy-fallback';
    }
    return 'legacy-fallback';
}

function httpBucket(model: string): AuthBucket {
    switch (model) {
        case 'isLoggedIn':
            return 'http-logged-in';
        case 'requiresAdmin':
            return 'http-admin';
        case 'requiresPlatformAdmin':
            return 'http-platform-admin';
        case 'requiresPermission':
            return 'http-permission';
        case 'requiresAuditView':
            return 'http-audit-view';
        case 'requiresObservabilityAuth':
            return 'http-observability';
        case 'route-permission':
            return 'http-route-permission';
        case 'public':
            return 'public';
        default:
            return 'http-unknown';
    }
}

export function generate(): AuthMatrix {
    const rpc = genRpc();
    const http = genHttp();
    const ws = genWs();

    const rows: AuthRow[] = [];

    for (const m of rpc.methods) {
        // Only record production-callable rows — DEV_MODE + inherited fall-through
        // lines would drown out the useful signal.
        if (m.env !== 'production') continue;
        if (m.kind !== 'explicit') continue;
        rows.push({
            transport: 'rpc',
            surface: `${m.namespace}.${m.method}`,
            authBucket: rpcBucket(m.permission),
            detail: m.permissionArgs ?? m.permission,
            sourceFile: m.sourceFile,
            sourceLine: m.sourceLine
        });
    }

    for (const r of http.routes) {
        const fullPath = (r.mount ?? '') + r.path;
        rows.push({
            transport: 'http',
            surface: `${r.method} ${fullPath}`,
            authBucket: httpBucket(r.authModel),
            detail: r.middleware.join(' + ') || '(no middleware)',
            sourceFile: r.sourceFile,
            sourceLine: r.sourceLine
        });
    }

    for (const p of ws.paths) {
        rows.push({
            transport: 'ws',
            surface: `WS ${p.pathname}`,
            authBucket: p.authRequired
                ? 'ws-authenticated'
                : 'ws-unauthenticated',
            detail: `handler: ${p.handler}`,
            sourceFile: p.sourceFile,
            sourceLine: p.sourceLine
        });
    }

    rows.sort((a, b) => {
        if (a.transport !== b.transport)
            return a.transport.localeCompare(b.transport);
        return a.surface.localeCompare(b.surface);
    });

    const byBucket: Record<string, number> = {};
    for (const r of rows) {
        byBucket[r.authBucket] = (byBucket[r.authBucket] ?? 0) + 1;
    }

    return {
        generator: 'transport-auth-matrix',
        version: 1,
        totals: {rows: rows.length, byBucket},
        rows
    };
}

export function renderMarkdown(m: AuthMatrix): string {
    const header = provenanceHeader('Transport / Auth Matrix', [
        'backend-rpc-inventory',
        'backend-http-inventory',
        'backend-ws-inventory'
    ]);

    const t = m.totals;
    const summary = [
        '## Totals',
        '',
        `- Rows across all transports: **${t.rows}**`,
        '- By auth bucket:',
        ...Object.entries(t.byBucket)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `  - \`${k}\`: **${v}**`),
        '',
        '> **Why this matters**: the plan mandates a single authorization model.',
        '> Every row in a bucket other than `crud-decorator` / `fine-grained-decorator`',
        '> / `ws-authenticated` / `http-logged-in` represents a surface whose auth',
        '> contract is legacy, implicit, or intentionally public.',
        ''
    ].join('\n');

    const byTransport = new Map<string, AuthRow[]>();
    for (const r of m.rows) {
        const list = byTransport.get(r.transport) ?? [];
        list.push(r);
        byTransport.set(r.transport, list);
    }

    const sections: string[] = [];
    for (const [transport, rows] of byTransport.entries()) {
        sections.push(`## \`${transport}\` — ${rows.length} rows`);
        sections.push('');
        sections.push('| Surface | Auth bucket | Detail | Source |');
        sections.push('|---|---|---|---|');
        for (const r of rows) {
            sections.push(
                `| \`${r.surface}\` | \`${r.authBucket}\` | ${mdEscape(r.detail)} | [${r.sourceFile}:${r.sourceLine}](../../${r.sourceFile}#L${r.sourceLine}) |`
            );
        }
        sections.push('');
    }

    return [header, summary, sections.join('\n')].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const m = generate();
    writeOutputs('transport-auth-matrix', m, renderMarkdown(m));
    console.log(
        `[transport-auth-matrix] ${m.totals.rows} rows | ${JSON.stringify(m.totals.byBucket)}`
    );
}
