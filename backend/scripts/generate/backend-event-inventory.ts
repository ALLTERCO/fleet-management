/**
 * Backend event inventory generator (Phase 0a).
 *
 * Scans every `emit*` / `notifyComponentEvent` function across backend/src/
 * for object-literal `{method: 'Foo.Bar', params: {...}}` shapes.
 *
 * Output: docs/generated/backend-event-inventory.{json,md}
 */

import ts from 'typescript';
import {
    BACKEND_SRC,
    FRONTEND_SRC,
    getBackendProgram,
    getBackendSourceFiles,
    lineOf,
    provenanceHeader,
    readFile,
    readStringArg,
    relPath,
    walkFiles,
    writeOutputs
} from './_shared.js';

export interface EventDefinition {
    emitFunction: string;
    eventName: string;
    paramsKeys: string[];
    sourceFile: string;
    sourceLine: number;
    frontendListeners: number;
}

export interface EventInventory {
    generator: 'backend-event-inventory';
    version: 1;
    totals: {
        events: number;
        uniqueNames: number;
    };
    events: EventDefinition[];
}

/** Scan a function body for `method: 'Foo.Bar'` and `params: {...keys...}` literals */
function extractEventLiteral(
    fn: ts.FunctionLikeDeclaration,
    source: ts.SourceFile
): {eventName: string; paramsKeys: string[]} | undefined {
    let eventName: string | undefined;
    let paramsKeys: string[] = [];
    const visit = (n: ts.Node): void => {
        if (ts.isObjectLiteralExpression(n)) {
            let isEventLiteral = false;
            for (const prop of n.properties) {
                if (
                    ts.isPropertyAssignment(prop) &&
                    ts.isIdentifier(prop.name) &&
                    prop.name.text === 'method'
                ) {
                    const name = readStringArg(prop.initializer);
                    if (name) {
                        eventName = name;
                        isEventLiteral = true;
                    }
                }
            }
            if (isEventLiteral) {
                for (const prop of n.properties) {
                    if (
                        ts.isPropertyAssignment(prop) &&
                        ts.isIdentifier(prop.name) &&
                        prop.name.text === 'params' &&
                        ts.isObjectLiteralExpression(prop.initializer)
                    ) {
                        paramsKeys = prop.initializer.properties
                            .map((p) =>
                                p.name && ts.isIdentifier(p.name)
                                    ? p.name.text
                                    : p.name && ts.isStringLiteral(p.name)
                                      ? p.name.text
                                      : '?'
                            )
                            .filter((k) => k !== '?');
                    }
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    if (fn.body) ts.forEachChild(fn.body, visit);
    if (!eventName) return undefined;
    return {eventName, paramsKeys};
}

function buildFrontendListenerIndex(): Map<string, number> {
    const counts = new Map<string, number>();
    const files = walkFiles(FRONTEND_SRC, ['.ts', '.vue', '.js']);
    // Match 'Namespace.EventName' strings in event subscription contexts
    const re = /['"]([A-Z][a-zA-Z0-9_]*\.[A-Z][a-zA-Z0-9_]*)['"]/g;
    for (const file of files) {
        let content: string;
        try {
            content = readFile(file);
        } catch {
            continue;
        }
        for (const m of content.matchAll(re)) {
            counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
        }
    }
    return counts;
}

/** Function name qualifies as an event emitter. */
function isEmitterName(name: string): boolean {
    return name.startsWith('emit') || name === 'notifyComponentEvent';
}

/** Collect `emit*` functions (any declaration form) from a source file. */
function collectEmitterFunctions(
    source: ts.SourceFile
): {name: string; fn: ts.FunctionLikeDeclaration}[] {
    const out: {name: string; fn: ts.FunctionLikeDeclaration}[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.name) {
            if (isEmitterName(node.name.text)) {
                out.push({name: node.name.text, fn: node});
            }
        } else if (ts.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
                if (
                    ts.isIdentifier(decl.name) &&
                    isEmitterName(decl.name.text) &&
                    decl.initializer &&
                    (ts.isArrowFunction(decl.initializer) ||
                        ts.isFunctionExpression(decl.initializer))
                ) {
                    out.push({name: decl.name.text, fn: decl.initializer});
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    return out;
}

export function generate(): EventInventory {
    const program = getBackendProgram();
    const frontendListeners = buildFrontendListenerIndex();
    const events: EventDefinition[] = [];
    const seenFns = new Set<string>();

    for (const source of getBackendSourceFiles(program)) {
        for (const {name, fn} of collectEmitterFunctions(source)) {
            const key = `${source.fileName}::${name}`;
            if (seenFns.has(key)) continue;
            seenFns.add(key);

            const extracted = extractEventLiteral(fn, source);
            if (!extracted) continue;

            events.push({
                emitFunction: name,
                eventName: extracted.eventName,
                paramsKeys: extracted.paramsKeys,
                sourceFile: relPath(source.fileName),
                sourceLine: lineOf(fn, source),
                frontendListeners:
                    frontendListeners.get(extracted.eventName) ?? 0
            });
        }
    }

    events.sort((a, b) => a.eventName.localeCompare(b.eventName));
    const uniqueNames = new Set(events.map((e) => e.eventName)).size;

    return {
        generator: 'backend-event-inventory',
        version: 1,
        totals: {events: events.length, uniqueNames},
        events
    };
}

export function renderMarkdown(inv: EventInventory): string {
    const header = provenanceHeader('Backend Event Inventory', [
        'backend/src/**/*.ts (any `emit*`/`notifyComponentEvent` with a method literal)'
    ]);

    const summary = [
        '## Totals',
        '',
        `- Emit functions: **${inv.totals.events}**`,
        `- Unique event names: **${inv.totals.uniqueNames}**`,
        ''
    ].join('\n');

    const table = [
        '## Events',
        '',
        '| Event name | Emit function | Params keys | Frontend listeners | Source |',
        '|---|---|---|---|---|',
        ...inv.events.map(
            (e) =>
                `| \`${e.eventName}\` | \`${e.emitFunction}\` | ${e.paramsKeys.map((k) => `\`${k}\``).join(', ')} | ${e.frontendListeners} | [${e.sourceFile}:${e.sourceLine}](../../${e.sourceFile}#L${e.sourceLine}) |`
        ),
        ''
    ].join('\n');

    return [header, summary, table].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const inv = generate();
    writeOutputs('backend-event-inventory', inv, renderMarkdown(inv));
    console.log(
        `[backend-event-inventory] ${inv.totals.events} emit fns | ${inv.totals.uniqueNames} unique event names`
    );
}
