/**
 * Frontend → backend dependency map generator (Phase 0a).
 *
 * Walks every frontend .ts/.vue/.js file and classifies every call that
 * reaches the backend:
 *
 *   - `sendRPC('FLEET_MANAGER', 'Namespace.Method', ...)` — FM-routed RPC
 *   - `sendRPC(entity.source, 'Method', ...)` — direct entity RPC
 *   - `sendRPC(shellyID, 'Method', ...)` — direct device RPC
 *   - `fetch('/rpc/...')` or `fetch('/api/...')` — HTTP call
 *
 * TypeScript's compiler API gives us proper AST traversal. Vue SFCs need
 * the script block extracted first (regex-free: via simple tag search).
 *
 * Output: docs/generated/frontend-backend-dependencies.{json,md}
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import {
    FRONTEND_SRC,
    lineOf,
    nodeText,
    provenanceHeader,
    readFile,
    readStringArg,
    relPath,
    walkFiles,
    writeOutputs
} from './_shared.js';

export type RpcRouting =
    | 'fleet-manager'
    | 'entity-direct'
    | 'device-direct'
    | 'http-rpc'
    | 'http-api';

export interface FrontendCall {
    routing: RpcRouting;
    /** For RPC: 'namespace.method' or 'method' if directly addressed. For HTTP: path. */
    target: string;
    sourceFile: string;
    sourceLine: number;
    /** The exact expression as it appears in source (truncated) */
    callText: string;
}

export interface FrontendDeps {
    generator: 'frontend-backend-dependencies';
    version: 1;
    totals: {
        calls: number;
        files: number;
        byRouting: Record<RpcRouting, number>;
    };
    files: string[];
    calls: FrontendCall[];
}

/**
 * Extract the <script> block from a .vue SFC, returning the text and the
 * line offset so lineOf() reports correct line numbers.
 */
function extractVueScript(
    content: string
): {text: string; lineOffset: number} | undefined {
    // Match <script ...> ... </script> — first occurrence wins
    const openMatch = content.match(/<script\b[^>]*>/);
    if (!openMatch || openMatch.index === undefined) return undefined;
    const openEnd = openMatch.index + openMatch[0].length;
    const closeIdx = content.indexOf('</script>', openEnd);
    if (closeIdx < 0) return undefined;
    const scriptText = content.slice(openEnd, closeIdx);
    const lineOffset = content.slice(0, openEnd).split('\n').length - 1;
    return {text: scriptText, lineOffset};
}

function classifyRpcDestination(destExpr: ts.Expression): RpcRouting {
    const text = destExpr.getText().replace(/\s+/g, '');
    if (text === "'FLEET_MANAGER'" || text === '"FLEET_MANAGER"') {
        return 'fleet-manager';
    }
    // entity.source, e.getSource(), etc.
    if (/\bsource\b/.test(text)) return 'entity-direct';
    // Anything that looks like a shellyID variable
    if (/\bshellyID?\b/i.test(text)) return 'device-direct';
    return 'device-direct';
}

function scanSourceFile(
    source: ts.SourceFile,
    lineOffset: number,
    callsOut: FrontendCall[]
): void {
    const sourceFile = relPath(source.fileName);
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            // ws.sendRPC(...) OR sendRPC(...)
            let isSendRpc = false;
            if (
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === 'sendRPC'
            ) {
                isSendRpc = true;
            } else if (
                ts.isIdentifier(node.expression) &&
                node.expression.text === 'sendRPC'
            ) {
                isSendRpc = true;
            }
            if (isSendRpc && node.arguments.length >= 2) {
                const [destArg, methodArg] = node.arguments;
                const method = readStringArg(methodArg);
                if (method) {
                    const routing = classifyRpcDestination(destArg);
                    const line = lineOf(node, source) + lineOffset;
                    callsOut.push({
                        routing,
                        target: method,
                        sourceFile,
                        sourceLine: line,
                        callText: nodeText(node, source)
                            .replace(/\s+/g, ' ')
                            .slice(0, 120)
                    });
                }
            }
            // fetch('/rpc/...') or fetch('/api/...')
            const isFetch =
                (ts.isIdentifier(node.expression) &&
                    node.expression.text === 'fetch') ||
                (ts.isPropertyAccessExpression(node.expression) &&
                    node.expression.name.text === 'fetch');
            if (isFetch && node.arguments.length >= 1) {
                const url = readStringArg(node.arguments[0]);
                if (url && (url.startsWith('/rpc') || url.startsWith('/api'))) {
                    const line = lineOf(node, source) + lineOffset;
                    callsOut.push({
                        routing: url.startsWith('/rpc')
                            ? 'http-rpc'
                            : 'http-api',
                        target: url,
                        sourceFile,
                        sourceLine: line,
                        callText: nodeText(node, source)
                            .replace(/\s+/g, ' ')
                            .slice(0, 120)
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
}

export function generate(): FrontendDeps {
    const files = walkFiles(FRONTEND_SRC, ['.ts', '.vue', '.js']);
    const calls: FrontendCall[] = [];
    const touchedFiles = new Set<string>();

    for (const file of files) {
        let content: string;
        try {
            content = readFile(file);
        } catch {
            continue;
        }

        if (file.endsWith('.vue')) {
            const script = extractVueScript(content);
            if (!script) continue;
            const source = ts.createSourceFile(
                file,
                script.text,
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TS
            );
            const before = calls.length;
            scanSourceFile(source, script.lineOffset, calls);
            if (calls.length > before) touchedFiles.add(relPath(file));
        } else {
            const source = ts.createSourceFile(
                file,
                content,
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TS
            );
            const before = calls.length;
            scanSourceFile(source, 0, calls);
            if (calls.length > before) touchedFiles.add(relPath(file));
        }
    }

    calls.sort((a, b) => {
        if (a.routing !== b.routing) return a.routing.localeCompare(b.routing);
        if (a.target !== b.target) return a.target.localeCompare(b.target);
        return a.sourceFile.localeCompare(b.sourceFile);
    });

    const byRouting: Record<RpcRouting, number> = {
        'fleet-manager': 0,
        'entity-direct': 0,
        'device-direct': 0,
        'http-rpc': 0,
        'http-api': 0
    };
    for (const c of calls) byRouting[c.routing]++;

    return {
        generator: 'frontend-backend-dependencies',
        version: 1,
        totals: {
            calls: calls.length,
            files: touchedFiles.size,
            byRouting
        },
        files: [...touchedFiles].sort(),
        calls
    };
}

export function renderMarkdown(deps: FrontendDeps): string {
    const header = provenanceHeader('Frontend → Backend Dependencies', [
        'frontend/src/**/*.{ts,vue,js}'
    ]);

    const t = deps.totals;
    const summary = [
        '## Totals',
        '',
        `- Total backend calls: **${t.calls}**`,
        `- Files with backend calls: **${t.files}**`,
        '- By routing:',
        ...Object.entries(t.byRouting).map(
            ([k, v]) => `  - \`${k}\`: **${v}**`
        ),
        ''
    ].join('\n');

    const byRouting = new Map<RpcRouting, FrontendCall[]>();
    for (const c of deps.calls) {
        const list = byRouting.get(c.routing) ?? [];
        list.push(c);
        byRouting.set(c.routing, list);
    }

    const sections: string[] = [];
    for (const [routing, list] of [...byRouting.entries()].sort((a, b) =>
        a[0].localeCompare(b[0])
    )) {
        sections.push(`## \`${routing}\` — ${list.length} calls`);
        sections.push('');
        sections.push('| Target | Source |');
        sections.push('|---|---|');
        for (const c of list) {
            sections.push(
                `| \`${c.target}\` | [${c.sourceFile}:${c.sourceLine}](../../${c.sourceFile}#L${c.sourceLine}) |`
            );
        }
        sections.push('');
    }

    return [header, summary, sections.join('\n')].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const deps = generate();
    writeOutputs('frontend-backend-dependencies', deps, renderMarkdown(deps));
    console.log(
        `[frontend-backend-dependencies] ${deps.totals.calls} calls across ${deps.totals.files} files | ${JSON.stringify(deps.totals.byRouting)}`
    );
}
