/**
 * Backend WebSocket inventory generator (Phase 0a).
 *
 * Scans WebsocketController.#handleUpgrades() for `pathname === '/...'` branches
 * and the handler names they route to.
 *
 * Also records maxPayload, auth gating, and queue limits from the handler classes.
 *
 * Output: docs/generated/backend-ws-inventory.{json,md}
 */

import * as path from 'node:path';
import ts from 'typescript';
import {
    BACKEND_SRC,
    getBackendProgram,
    lineOf,
    nodeText,
    provenanceHeader,
    readStringArg,
    relPath,
    writeOutputs
} from './_shared.js';

export interface WsUpgradePath {
    pathname: string;
    authRequired: boolean;
    handler: string;
    sourceFile: string;
    sourceLine: number;
}

export interface WsHandlerInfo {
    className: string;
    sourceFile: string;
    sourceLine: number;
    maxPayload?: number;
    maxAuthQueue?: number;
    notes: string[];
}

export interface WsInventory {
    generator: 'backend-ws-inventory';
    version: 1;
    totals: {
        upgradePaths: number;
        handlers: number;
    };
    paths: WsUpgradePath[];
    handlers: WsHandlerInfo[];
}

/** Extract upgrade paths from the if/else chain in WebsocketController */
function scanController(source: ts.SourceFile): WsUpgradePath[] {
    const out: WsUpgradePath[] = [];
    const sourceFile = relPath(source.fileName);
    let authRequiredAtCurrentDepth = false;

    const visit = (node: ts.Node, authContext: boolean): void => {
        // Track when `if (!token) rejectUpgrade(...)` sets the auth context
        if (ts.isIfStatement(node)) {
            const cond = node.expression;
            if (
                ts.isPrefixUnaryExpression(cond) &&
                cond.operator === ts.SyntaxKind.ExclamationToken &&
                ts.isIdentifier(cond.operand) &&
                cond.operand.text === 'token'
            ) {
                // Visit downstream branches with authRequired=true
                // (the previous branch rejected unauthenticated requests)
                ts.forEachChild(node, (n) => visit(n, authContext));
                authRequiredAtCurrentDepth = true;
                return;
            }
        }

        // Match `pathname === '/xxx'` or `pathname.startsWith('/xxx')`
        let matchedPath: string | undefined;
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
            ts.isIdentifier(node.left) &&
            node.left.text === 'pathname'
        ) {
            matchedPath = readStringArg(node.right);
        }
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'startsWith' &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === 'pathname'
        ) {
            matchedPath = readStringArg(node.arguments[0]);
        }
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'isNodeRedPath' &&
            ts.isIdentifier(node.arguments[0]) &&
            node.arguments[0].text === 'pathname'
        ) {
            matchedPath = '/node-red';
        }

        if (matchedPath) {
            // Walk up one IfStatement to find the consequent block, extract handler name
            let handlerName = 'unknown';
            let bodyText = '';
            const parent = (node as ts.Node & {parent?: ts.Node}).parent;
            if (parent && ts.isIfStatement(parent)) {
                const consequent = parent.thenStatement;
                bodyText = nodeText(consequent, source);
                const handlerMatch = bodyText.match(
                    /this\.#(\w+)\.handleUpgrade/
                );
                if (handlerMatch) handlerName = handlerMatch[1];
            }
            // The pathname check is emitted BEFORE its body is visited,
            // so an `if (!token)` reject inside the body has not yet
            // bumped authRequiredAtCurrentDepth. Look directly at the
            // consequent text for the same reject pattern as an
            // additional signal so /'s in-body token gate counts.
            const bodyEnforcesToken = /if \(!token\)[\s\S]*?rejectUpgrade/.test(
                bodyText
            );
            out.push({
                pathname: matchedPath,
                authRequired:
                    matchedPath !== '/shelly' &&
                    (authRequiredAtCurrentDepth || bodyEnforcesToken),
                handler: handlerName,
                sourceFile,
                sourceLine: lineOf(node, source)
            });
        }
        ts.forEachChild(node, (n) => visit(n, authContext));
    };
    ts.forEachChild(source, (n) => visit(n, false));
    return out;
}

/** Collect top-level numeric `const NAME = …` so identifier references in
 *  property initializers (e.g. `maxPayload: MAX_PAYLOAD_BYTES`) can be
 *  resolved at AST eval time. */
function collectNumericConstants(source: ts.SourceFile): Map<string, number> {
    const out = new Map<string, number>();
    ts.forEachChild(source, (node) => {
        if (!ts.isVariableStatement(node)) return;
        for (const decl of node.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
            const value = evalNumeric(decl.initializer, out);
            if (value !== undefined) out.set(decl.name.text, value);
        }
    });
    return out;
}

/** Parse a WS handler class for its static limits (maxPayload, MAX_AUTH_QUEUE) */
function scanHandler(source: ts.SourceFile): WsHandlerInfo | undefined {
    let info: WsHandlerInfo | undefined;
    const constants = collectNumericConstants(source);
    ts.forEachChild(source, (node) => {
        if (!ts.isClassDeclaration(node) || !node.name) return;
        const className = node.name.text;
        if (!className.endsWith('WebsocketHandler')) return;

        const notes: string[] = [];
        let maxPayload: number | undefined;
        let maxAuthQueue: number | undefined;

        const visit = (n: ts.Node): void => {
            // property initializer like `maxPayload: 5 * 1024 * 1024` or
            // `maxPayload: MAX_PAYLOAD_BYTES` (Identifier ref into same file).
            if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) {
                if (n.name.text === 'maxPayload') {
                    const evaluated = evalNumeric(n.initializer, constants);
                    if (evaluated !== undefined) maxPayload = evaluated;
                }
                if (n.name.text === 'maxAuthQueue') {
                    const evaluated = evalNumeric(n.initializer, constants);
                    if (evaluated !== undefined) maxAuthQueue = evaluated;
                }
            }
            // const MAX_AUTH_QUEUE = 25
            if (
                ts.isVariableDeclaration(n) &&
                ts.isIdentifier(n.name) &&
                n.name.text === 'MAX_AUTH_QUEUE' &&
                n.initializer
            ) {
                const evaluated = evalNumeric(n.initializer, constants);
                if (evaluated !== undefined) maxAuthQueue = evaluated;
            }
            ts.forEachChild(n, visit);
        };
        ts.forEachChild(source, visit);

        info = {
            className,
            sourceFile: relPath(source.fileName),
            sourceLine: lineOf(node, source),
            maxPayload,
            maxAuthQueue,
            notes
        };
    });
    return info;
}

function evalNumeric(
    node: ts.Expression,
    constants?: Map<string, number>
): number | undefined {
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isIdentifier(node) && constants) {
        return constants.get(node.text);
    }
    if (ts.isBinaryExpression(node)) {
        const left = evalNumeric(node.left, constants);
        const right = evalNumeric(node.right, constants);
        if (left === undefined || right === undefined) return undefined;
        switch (node.operatorToken.kind) {
            case ts.SyntaxKind.AsteriskToken:
                return left * right;
            case ts.SyntaxKind.PlusToken:
                return left + right;
            case ts.SyntaxKind.MinusToken:
                return left - right;
            case ts.SyntaxKind.SlashToken:
                return left / right;
        }
    }
    return undefined;
}

export function generate(): WsInventory {
    const program = getBackendProgram();
    const controllerPath = path.join(
        BACKEND_SRC,
        'modules/web/ws/WebsocketController.ts'
    );
    const controller = program.getSourceFile(controllerPath);

    const paths: WsUpgradePath[] = controller ? scanController(controller) : [];

    const handlerDir = path.join(BACKEND_SRC, 'modules/web/ws/handlers');
    const handlers: WsHandlerInfo[] = [];
    for (const sf of program.getSourceFiles()) {
        if (!sf.fileName.startsWith(handlerDir + path.sep)) continue;
        const h = scanHandler(sf);
        if (h) handlers.push(h);
    }

    paths.sort((a, b) => a.pathname.localeCompare(b.pathname));
    handlers.sort((a, b) => a.className.localeCompare(b.className));

    return {
        generator: 'backend-ws-inventory',
        version: 1,
        totals: {
            upgradePaths: paths.length,
            handlers: handlers.length
        },
        paths,
        handlers
    };
}

export function renderMarkdown(inv: WsInventory): string {
    const header = provenanceHeader('Backend WebSocket Inventory', [
        'backend/src/modules/web/ws/**/*.ts'
    ]);

    const summary = [
        '## Totals',
        '',
        `- Upgrade paths: **${inv.totals.upgradePaths}**`,
        `- Handlers: **${inv.totals.handlers}**`,
        ''
    ].join('\n');

    const pathTable = [
        '## Upgrade paths',
        '',
        '| Path | Auth required | Handler | Source |',
        '|---|---|---|---|',
        ...inv.paths.map(
            (p) =>
                `| \`${p.pathname}\` | ${p.authRequired ? 'yes' : 'no'} | ${p.handler} | [${p.sourceFile}:${p.sourceLine}](../../${p.sourceFile}#L${p.sourceLine}) |`
        ),
        ''
    ].join('\n');

    const handlerTable = [
        '## Handlers',
        '',
        '| Class | maxPayload (bytes) | maxAuthQueue | Source |',
        '|---|---|---|---|',
        ...inv.handlers.map(
            (h) =>
                `| ${h.className} | ${h.maxPayload ?? ''} | ${h.maxAuthQueue ?? ''} | [${h.sourceFile}:${h.sourceLine}](../../${h.sourceFile}#L${h.sourceLine}) |`
        ),
        ''
    ].join('\n');

    return [header, summary, pathTable, handlerTable].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const inv = generate();
    writeOutputs('backend-ws-inventory', inv, renderMarkdown(inv));
    console.log(
        `[backend-ws-inventory] ${inv.totals.upgradePaths} paths | ${inv.totals.handlers} handlers`
    );
}
