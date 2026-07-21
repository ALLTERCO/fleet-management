// Shared AST helpers over the Host SDK source: domains, member shapes,
// factory namespaces, wrapper-to-RPC mapping. One parser for all gates.
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import {REPO_ROOT, walkFiles} from './_shared.js';

export const HOST_DIR = path.join(
    REPO_ROOT,
    'frontend/src/shell/template-host'
);

let cachedBaseMembers: Set<string> | undefined;

/** Members every factory proxy carries — read from createHostDomain(). */
export function factoryBaseMembers(): Set<string> {
    if (cachedBaseMembers) return cachedBaseMembers;
    const source = parseSource(path.join(HOST_DIR, 'domain.ts'));
    const members = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.getText(source) === 'Object.assign'
        ) {
            const arg = node.arguments[1];
            if (arg && ts.isObjectLiteralExpression(arg)) {
                for (const prop of arg.properties) {
                    const name = prop.name
                        ? propertyName(prop.name)
                        : undefined;
                    if (name) members.add(name);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    if (members.size === 0) {
        throw new Error('createHostDomain members not found in domain.ts');
    }
    cachedBaseMembers = members;
    return members;
}

export type DomainShape =
    | {kind: 'object'; keys: Set<string>; nested: Map<string, DomainShape>}
    | {kind: 'factory'; namespace: string};

export function parseSource(file: string): ts.SourceFile {
    return ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
    );
}

function unwrapExpression(node: ts.Expression): ts.Expression {
    let current = node;
    while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
        current = current.expression;
    }
    return current;
}

function propertyName(
    name: ts.PropertyName | ts.BindingName
): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    return undefined;
}

function factoryNamespace(node: ts.Node): string | undefined {
    if (!ts.isCallExpression(node)) return undefined;
    const callee = node.expression;
    if (!ts.isIdentifier(callee) || callee.text !== 'createHostDomain') {
        return undefined;
    }
    const arg = node.arguments[0];
    return arg && ts.isStringLiteral(arg) ? arg.text : undefined;
}

export function shapeOf(node: ts.Expression): DomainShape | undefined {
    const value = unwrapExpression(node);
    const namespace = factoryNamespace(value);
    if (namespace) return {kind: 'factory', namespace};
    if (!ts.isObjectLiteralExpression(value)) return undefined;
    const shape: DomainShape = {
        kind: 'object',
        keys: new Set(),
        nested: new Map()
    };
    for (const prop of value.properties) {
        const name = prop.name ? propertyName(prop.name) : undefined;
        if (!name) continue;
        shape.keys.add(name);
        if (ts.isPropertyAssignment(prop)) {
            const child = shapeOf(prop.initializer);
            if (child) shape.nested.set(name, child);
        }
    }
    return shape;
}

function isExported(statement: ts.VariableStatement): boolean {
    return (
        statement.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword
        ) ?? false
    );
}

function exportedInitializer(
    source: ts.SourceFile,
    exportName: string
): ts.Expression | undefined {
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement) || !isExported(statement)) {
            continue;
        }
        for (const declaration of statement.declarationList.declarations) {
            if (propertyName(declaration.name) !== exportName) continue;
            return declaration.initializer;
        }
    }
    return undefined;
}

export function exportedShape(
    source: ts.SourceFile,
    exportName: string
): DomainShape | undefined {
    const initializer = exportedInitializer(source, exportName);
    return initializer ? shapeOf(initializer) : undefined;
}

export function sdkSourceFiles(): string[] {
    return walkFiles(HOST_DIR, ['.ts']).filter(
        (file) => !file.includes(`${path.sep}generated${path.sep}`)
    );
}

/** Members of the `host` object mapped to the module file each came from. */
export function hostDomainFiles(): Map<string, string> {
    const source = parseSource(path.join(HOST_DIR, 'index.ts'));
    const importFiles = new Map<string, string>();
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const spec = statement.moduleSpecifier;
        if (!ts.isStringLiteral(spec) || !spec.text.startsWith('./')) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
            importFiles.set(
                element.name.text,
                path.join(HOST_DIR, `${spec.text.slice(2)}.ts`)
            );
        }
    }
    const host = exportedShape(source, 'host');
    if (!host || host.kind !== 'object') {
        throw new Error('export const host = {...} not found in index.ts');
    }
    const out = new Map<string, string>();
    for (const domain of host.keys) {
        const file = importFiles.get(domain);
        if (file) out.set(domain, file);
    }
    return out;
}

// Type positions skipped so a param type can't masquerade as a call.
function firstKnownRpcId(
    node: ts.Node,
    validIds: Set<string>
): string | undefined {
    let found: string | undefined;
    const visit = (child: ts.Node): void => {
        if (found || ts.isLiteralTypeNode(child)) return;
        if (
            ts.isStringLiteral(child) &&
            validIds.has(child.text.toLowerCase())
        ) {
            found = child.text.toLowerCase();
            return;
        }
        ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
}

function collectWrappers(
    literal: ts.ObjectLiteralExpression,
    prefix: string,
    validIds: Set<string>,
    out: Map<string, string>
): void {
    for (const prop of literal.properties) {
        const name = prop.name ? propertyName(prop.name) : undefined;
        // `call` members are the raw escape hatch, never a recommendation.
        if (!name || name === 'call') continue;
        if (ts.isPropertyAssignment(prop)) {
            const value = unwrapExpression(prop.initializer);
            if (ts.isObjectLiteralExpression(value)) {
                collectWrappers(value, `${prefix}.${name}`, validIds, out);
                continue;
            }
        }
        const id = firstKnownRpcId(prop, validIds);
        if (id && !out.has(id)) out.set(id, `${prefix}.${name}`);
    }
}

/** RPC id -> hand-written wrapper path. Factory proxies excluded —
 *  only curated object-literal wrappers count as recommendations. */
export function domainWrapperMap(validIds: Set<string>): Map<string, string> {
    const out = new Map<string, string>();
    for (const [domain, file] of hostDomainFiles()) {
        const initializer = exportedInitializer(parseSource(file), domain);
        if (!initializer) continue;
        const value = unwrapExpression(initializer);
        if (!ts.isObjectLiteralExpression(value)) continue;
        collectWrappers(value, `host.${domain}`, validIds, out);
    }
    return out;
}

const RPC_LITERAL = /'([a-z][\w-]*\.[\w.-]+)'/g;

/** Lowercased dotted string literals per SDK module (generated excluded). */
export function moduleRpcLiterals(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const file of sdkSourceFiles()) {
        const name = path.basename(file, '.ts');
        const literals = out.get(name) ?? new Set<string>();
        for (const match of fs
            .readFileSync(file, 'utf8')
            .matchAll(RPC_LITERAL)) {
            literals.add(match[1].toLowerCase());
        }
        out.set(name, literals);
    }
    return out;
}

/** Every createHostDomain('<ns>') namespace mapped to the files using it. */
export function factoryNamespaces(): Map<string, string[]> {
    const byNamespace = new Map<string, string[]>();
    for (const file of sdkSourceFiles()) {
        const visit = (node: ts.Node): void => {
            const namespace = factoryNamespace(node);
            if (namespace) {
                const files = byNamespace.get(namespace) ?? [];
                files.push(path.relative(REPO_ROOT, file));
                byNamespace.set(namespace, files);
            }
            ts.forEachChild(node, visit);
        };
        visit(parseSource(file));
    }
    return byNamespace;
}
