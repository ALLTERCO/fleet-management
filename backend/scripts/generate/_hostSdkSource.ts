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

function importedSourceFile(
    source: ts.SourceFile,
    localName: string
): string | undefined {
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const specifier = statement.moduleSpecifier;
        if (!ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) {
            continue;
        }
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        const imported = bindings.elements.find(
            (element) => element.name.text === localName
        );
        if (!imported) continue;
        const candidate = path.resolve(
            path.dirname(source.fileName),
            specifier.text
        );
        return path.extname(candidate) ? candidate : `${candidate}.ts`;
    }
    return undefined;
}

function returnedObjectLiteral(
    source: ts.SourceFile,
    functionName: string
): ts.ObjectLiteralExpression | undefined {
    const declaration = source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(statement) &&
            statement.name?.text === functionName
    );
    if (!declaration?.body) return undefined;

    const objects = new Map<string, ts.ObjectLiteralExpression>();
    for (const statement of declaration.body.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const variable of statement.declarationList.declarations) {
            const name = propertyName(variable.name);
            const initializer = variable.initializer
                ? unwrapExpression(variable.initializer)
                : undefined;
            if (
                name &&
                initializer &&
                ts.isObjectLiteralExpression(initializer)
            ) {
                objects.set(name, initializer);
            }
        }
    }
    for (const statement of declaration.body.statements) {
        if (!ts.isReturnStatement(statement) || !statement.expression) continue;
        const returned = unwrapExpression(statement.expression);
        if (ts.isObjectLiteralExpression(returned)) return returned;
        if (ts.isIdentifier(returned)) return objects.get(returned.text);
    }
    return undefined;
}

function factoryObjectLiteral(
    source: ts.SourceFile,
    initializer: ts.Expression
): ts.ObjectLiteralExpression | undefined {
    const value = unwrapExpression(initializer);
    if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression)) {
        return undefined;
    }
    const factoryFile = importedSourceFile(source, value.expression.text);
    if (!factoryFile || !fs.existsSync(factoryFile)) return undefined;
    return returnedObjectLiteral(
        parseSource(factoryFile),
        value.expression.text
    );
}

/**
 * Resolves `domain.binding` where `domain` is a local const holding a factory
 * call, to that factory's returned `binding` group.
 *
 * A module that aliases a core domain (`bindings: domain.binding`) carries no
 * nested literal, so without this the alias looks like a leaf and every
 * wrapper name under it is lost from the catalog.
 */
function aliasedShape(
    source: ts.SourceFile,
    node: ts.Expression
): DomainShape | undefined {
    const value = unwrapExpression(node);
    if (!ts.isPropertyAccessExpression(value)) return undefined;
    const target = value.expression;
    if (!ts.isIdentifier(target)) return undefined;
    const local = localInitializer(source, target.text);
    const object = local && factoryObjectLiteral(source, local);
    if (!object) return undefined;
    const parent = shapeOf(object);
    return parent?.kind === 'object'
        ? parent.nested.get(value.name.text)
        : undefined;
}

/** A non-exported `const x = ...` in the same file. */
function localInitializer(
    source: ts.SourceFile,
    name: string
): ts.Expression | undefined {
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (propertyName(declaration.name) === name) {
                return declaration.initializer;
            }
        }
    }
    return undefined;
}

function objectShapeResolvingAliases(
    source: ts.SourceFile,
    value: ts.ObjectLiteralExpression
): DomainShape {
    const shape: DomainShape = {
        kind: 'object',
        keys: new Set(),
        nested: new Map()
    };
    for (const prop of value.properties) {
        const name = prop.name ? propertyName(prop.name) : undefined;
        if (!name) continue;
        shape.keys.add(name);
        if (!ts.isPropertyAssignment(prop)) continue;
        const child =
            shapeOf(prop.initializer) ?? aliasedShape(source, prop.initializer);
        if (child) shape.nested.set(name, child);
    }
    return shape;
}

export function exportedShape(
    source: ts.SourceFile,
    exportName: string
): DomainShape | undefined {
    const initializer = exportedInitializer(source, exportName);
    if (!initializer) return undefined;
    const unwrapped = unwrapExpression(initializer);
    if (ts.isObjectLiteralExpression(unwrapped)) {
        return objectShapeResolvingAliases(source, unwrapped);
    }
    const direct = shapeOf(initializer);
    if (direct) return direct;
    const factoryObject = factoryObjectLiteral(source, initializer);
    return factoryObject ? shapeOf(factoryObject) : undefined;
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
    out: Map<string, string>,
    source?: ts.SourceFile
): void {
    for (const prop of literal.properties) {
        const name = prop.name ? propertyName(prop.name) : undefined;
        // `call` members are the raw escape hatch, never a recommendation.
        if (!name || name === 'call') continue;
        if (ts.isPropertyAssignment(prop)) {
            const value = unwrapExpression(prop.initializer);
            if (ts.isObjectLiteralExpression(value)) {
                collectWrappers(
                    value,
                    `${prefix}.${name}`,
                    validIds,
                    out,
                    source
                );
                continue;
            }
            // `bindings: domain.binding` — a module that aliases a core group
            // instead of restating it. Without following it, every wrapper
            // name underneath disappears from the catalog.
            const aliased = source && aliasedObjectLiteral(source, value);
            if (aliased) {
                collectWrappers(
                    aliased,
                    `${prefix}.${name}`,
                    validIds,
                    out,
                    source
                );
                continue;
            }
        }
        const id = firstKnownRpcId(prop, validIds);
        if (id && !out.has(id)) out.set(id, `${prefix}.${name}`);
    }
}

/** `domain.binding` -> the object literal that factory returns for `binding`. */
function aliasedObjectLiteral(
    source: ts.SourceFile,
    value: ts.Expression
): ts.ObjectLiteralExpression | undefined {
    if (!ts.isPropertyAccessExpression(value)) return undefined;
    const target = value.expression;
    if (!ts.isIdentifier(target)) return undefined;
    const local = localInitializer(source, target.text);
    const object = local && factoryObjectLiteral(source, local);
    if (!object) return undefined;
    for (const prop of object.properties) {
        if (
            ts.isPropertyAssignment(prop) &&
            propertyName(prop.name) === value.name.text
        ) {
            const nested = unwrapExpression(prop.initializer);
            if (ts.isObjectLiteralExpression(nested)) return nested;
        }
    }
    return undefined;
}

/** RPC id -> hand-written wrapper path. Factory proxies excluded —
 *  only curated object-literal wrappers count as recommendations. */
export function domainWrapperMap(validIds: Set<string>): Map<string, string> {
    const out = new Map<string, string>();
    for (const [domain, file] of hostDomainFiles()) {
        const source = parseSource(file);
        const initializer = exportedInitializer(source, domain);
        if (!initializer) continue;
        const value = unwrapExpression(initializer);
        const literal = ts.isObjectLiteralExpression(value)
            ? value
            : factoryObjectLiteral(source, initializer);
        if (!literal) continue;
        collectWrappers(literal, `host.${domain}`, validIds, out, source);
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

/**
 * Modules that only re-bind a core domain, mapped to the domain file they bind.
 *
 * `export const firmware = createFirmwareDomain(hostRpcAccess)` carries no RPC
 * literal and no createHostDomain call, so without this the module reports no
 * namespace at all — the generated index would say a re-bound surface touches
 * nothing. The namespaces are the bound domain's; this says where to read them.
 */
export function rebindTargets(): Map<string, string> {
    const out = new Map<string, string>();
    for (const file of sdkSourceFiles()) {
        const src = fs.readFileSync(file, 'utf8');
        const bound = [
            ...src.matchAll(
                /import\s*\{\s*(create\w+Domain)\s*\}\s*from\s*'(\.[^']*domains\/[\w-]+)'/g
            )
        ];
        if (bound.length !== 1) continue;
        const [, factory, spec] = bound[0];
        if (!new RegExp(`=\\s*${factory}\\(`).test(src)) continue;
        out.set(path.basename(file, '.ts'), path.basename(spec));
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
