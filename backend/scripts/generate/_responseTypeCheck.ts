// Does the declared response schema match what the handler actually returns?
//
// A schema is the contract; the handler is supposed to satisfy it. Nothing
// checked that. So `certificate.Import` declared `device_group_ids` and never
// sent it, and `user_group.Update` promised `member_count` it never returns —
// both invisible until someone read the SQL.
//
// This reports; it never rewrites. Where TypeScript cannot see a return type
// the answer is "cannot tell", not "mismatch": 584 device methods relay
// firmware responses as `any`, and for those the schema is the ONLY source of
// truth, not a copy of one.

import * as path from 'node:path';
import ts from 'typescript';
import {BACKEND_ROOT, getBackendProgram, relPath} from './_shared.js';

export type Verdict = 'match' | 'mismatch' | 'unknown-type' | 'no-handler';

export interface ResponseCheck {
    id: string;
    verdict: Verdict;
    /** Fields the schema promises that the return type does not have. */
    declaredOnly: string[];
    /** Fields the handler returns that the schema never mentions. */
    returnedOnly: string[];
    sourceFile?: string;
    sourceLine?: number;
    note?: string;
}

/** `Promise<T>` -> `T`; anything else unchanged. */
function unwrapPromise(type: ts.Type, checker: ts.TypeChecker): ts.Type {
    const symbol = type.getSymbol();
    if (symbol?.getName() !== 'Promise') return type;
    const args = checker.getTypeArguments(type as ts.TypeReference);
    return args.length === 1 ? args[0] : type;
}

/** True when the checker knows nothing useful — `any`, `unknown`, `object`. */
function isUninformative(type: ts.Type, checker: ts.TypeChecker): boolean {
    const flags = type.getFlags();
    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
    // A bare `object` with no members says as little as `any` does.
    return checker.typeToString(type) === 'object';
}

interface Shape {
    /** Every field the type can carry. */
    all: Set<string>;
    /** Fields it always carries — optional ones are excluded. */
    always: Set<string>;
}

/**
 * What a return type carries, split by whether the field is always there.
 *
 * The split is the whole point. A schema may declare a field the handler only
 * sets sometimes (a token returned in push mode, a debug section behind a
 * level) — that is correct, not a bug. Only a field promised as REQUIRED and
 * never returned is a broken promise.
 *
 * A union answers with what every branch has: a field only some branches carry
 * is not something the caller can rely on.
 */
function shapeOfType(
    type: ts.Type,
    checker: ts.TypeChecker
): Shape | undefined {
    if (type.isUnion()) {
        const branches = type.types
            .filter((t) => !(t.getFlags() & ts.TypeFlags.Undefined))
            .map((t) => shapeOfType(t, checker));
        if (branches.length === 0 || branches.some((b) => !b)) return undefined;
        const [first, ...rest] = branches as Shape[];
        const common = (pick: (s: Shape) => Set<string>) =>
            new Set(
                [...pick(first)].filter((n) =>
                    rest.every((b) => pick(b).has(n))
                )
            );
        return {all: common((s) => s.all), always: common((s) => s.always)};
    }
    if (isUninformative(type, checker)) return undefined;
    const props = checker.getPropertiesOfType(type);
    if (props.length === 0) return undefined;
    const all = new Set(props.map((p) => p.getName()));
    const always = new Set(
        props
            .filter((p) => !(p.getFlags() & ts.SymbolFlags.Optional))
            .map((p) => p.getName())
    );
    return {all, always};
}

/** The same split for a schema: everything it names, and what it requires. */
function shapeOfSchema(schema: unknown): Shape | undefined {
    if (!schema || typeof schema !== 'object') return undefined;
    const s = schema as {
        properties?: Record<string, unknown>;
        required?: string[];
        anyOf?: unknown[];
    };
    if (Array.isArray(s.anyOf)) {
        const branches = s.anyOf.map(shapeOfSchema);
        if (branches.some((b) => !b)) return undefined;
        const [first, ...rest] = branches as Shape[];
        const common = (pick: (x: Shape) => Set<string>) =>
            new Set(
                [...pick(first)].filter((n) =>
                    rest.every((b) => pick(b).has(n))
                )
            );
        return {all: common((x) => x.all), always: common((x) => x.always)};
    }
    if (!s.properties) return undefined;
    return {
        all: new Set(Object.keys(s.properties)),
        always: new Set(s.required ?? [])
    };
}

interface Handler {
    file: ts.SourceFile;
    node: ts.MethodDeclaration;
}

/** `namespace.method` (lowercased) -> the decorated handler behind it. */
export function indexHandlers(program: ts.Program): Map<string, Handler> {
    const out = new Map<string, Handler>();
    const componentDir = path.join(BACKEND_ROOT, 'src/model/component');
    for (const file of program.getSourceFiles()) {
        if (file.isDeclarationFile) continue;
        if (!file.fileName.includes(`${path.sep}src${path.sep}`)) continue;
        const inComponents = file.fileName.startsWith(componentDir);
        const inModules = file.fileName.includes(
            `${path.sep}src${path.sep}modules${path.sep}`
        );
        if (!inComponents && !inModules) continue;

        for (const statement of file.statements) {
            if (!ts.isClassDeclaration(statement)) continue;
            const namespace = namespaceOfClass(statement, file);
            if (!namespace) continue;
            for (const member of statement.members) {
                if (!ts.isMethodDeclaration(member)) continue;
                const exposed = exposedName(member, file);
                if (!exposed) continue;
                out.set(`${namespace}.${exposed}`.toLowerCase(), {
                    file,
                    node: member
                });
            }
        }
    }
    return out;
}

/** The namespace a component registers, from its `super('<name>', ...)` call. */
function namespaceOfClass(
    cls: ts.ClassDeclaration,
    source: ts.SourceFile
): string | undefined {
    let found: string | undefined;
    const visit = (node: ts.Node): void => {
        if (
            !found &&
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.SuperKeyword
        ) {
            const first = node.arguments[0];
            if (first && ts.isStringLiteral(first)) found = first.text;
        }
        ts.forEachChild(node, visit);
    };
    visit(cls);
    return found ?? undefined;
}

function exposedName(
    member: ts.MethodDeclaration,
    source: ts.SourceFile
): string | undefined {
    for (const dec of ts.getDecorators(member) ?? []) {
        if (!ts.isCallExpression(dec.expression)) continue;
        const callee = dec.expression.expression.getText(source);
        if (callee !== 'Component.Expose') continue;
        const arg = dec.expression.arguments[0];
        if (arg && ts.isStringLiteral(arg)) return arg.text;
        // `@Component.Expose()` with no argument takes the method's own name.
        return member.name.getText(source);
    }
    return undefined;
}

/** Compares one declared response schema against its handler's return type. */
export function checkResponse(
    id: string,
    responseSchema: unknown,
    handlers: Map<string, Handler>,
    checker: ts.TypeChecker
): ResponseCheck {
    const handler = handlers.get(id.toLowerCase());
    if (!handler) {
        return {id, verdict: 'no-handler', declaredOnly: [], returnedOnly: []};
    }
    const sourceFile = relPath(handler.file.fileName);
    const sourceLine =
        handler.file.getLineAndCharacterOfPosition(handler.node.getStart())
            .line + 1;

    const signature = checker.getSignatureFromDeclaration(handler.node);
    const returned = signature
        ? unwrapPromise(checker.getReturnTypeOfSignature(signature), checker)
        : undefined;
    const returnedShape = returned ? shapeOfType(returned, checker) : undefined;
    const declaredShape = shapeOfSchema(responseSchema);

    if (!returnedShape) {
        return {
            id,
            verdict: 'unknown-type',
            declaredOnly: [],
            returnedOnly: [],
            sourceFile,
            sourceLine,
            note: returned ? checker.typeToString(returned) : 'no signature'
        };
    }
    if (!declaredShape) {
        return {
            id,
            verdict: 'unknown-type',
            declaredOnly: [],
            returnedOnly: [],
            sourceFile,
            sourceLine,
            note: 'schema declares no properties'
        };
    }

    // Promised as required, never returned — the caller is told to expect it.
    const declaredOnly = [...declaredShape.always].filter(
        (name) => !returnedShape.all.has(name)
    );
    // Always returned, never declared — the caller cannot see it exists.
    const returnedOnly = [...returnedShape.always].filter(
        (name) => !declaredShape.all.has(name)
    );
    return {
        id,
        verdict:
            declaredOnly.length + returnedOnly.length === 0
                ? 'match'
                : 'mismatch',
        declaredOnly,
        returnedOnly,
        sourceFile,
        sourceLine
    };
}

export function buildChecker() {
    const program = getBackendProgram();
    return {
        checker: program.getTypeChecker(),
        handlers: indexHandlers(program)
    };
}
