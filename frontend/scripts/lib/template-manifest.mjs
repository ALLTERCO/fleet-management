import fs from 'node:fs';
import {
    listOperationalBindingKeys,
    OPERATIONAL_BINDING_SPECS,
    validateOperationalBindings
} from '../../src/shell/operational-binding-contract.ts';

// The TypeScript compiler is handed in, not imported.
//
// This parser is shared by backend/scripts/validate-bm-deploy-request.mjs and
// frontend/scripts/validate-template-package.mjs. Node resolves a bare import
// from THIS file's folder upward, so an `import ts from 'typescript'` here only
// ever finds frontend/node_modules — and the backend CI job installs backend
// deps only. That is why a backend test died with "Cannot find module
// 'typescript'" while passing on a laptop that happened to have both installed.
//
// The two sides are also on different majors (frontend 5, backend 6), so there
// is no one copy to share. Each caller passes the compiler it declares.
let ts;

/** Called once by each entry point with its own `typescript` import. */
export function useTypeScript(compiler) {
    ts = compiler;
}

function requireCompiler() {
    if (!ts) {
        throw new Error(
            'template-manifest: call useTypeScript(ts) before reading a manifest'
        );
    }
    return ts;
}

function fail(file, node, message) {
    const source = node.getSourceFile();
    const {line, character} = source.getLineAndCharacterOfPosition(
        node.getStart(source)
    );
    throw new Error(`${file}:${line + 1}:${character + 1}: ${message}`);
}

function unwrap(node) {
    while (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isTypeAssertionExpression(node)
    ) {
        node = node.expression;
    }
    return node;
}

function propertyName(file, name) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    if (ts.isNumericLiteral(name)) return name.text;
    fail(file, name, 'manifest property names must be static literals');
}

function evaluate(file, node) {
    node = unwrap(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (
        ts.isPrefixUnaryExpression(node) &&
        (node.operator === ts.SyntaxKind.MinusToken ||
            node.operator === ts.SyntaxKind.PlusToken) &&
        ts.isNumericLiteral(node.operand)
    ) {
        const value = Number(node.operand.text);
        return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
    }
    if (ts.isArrayLiteralExpression(node)) {
        return node.elements.map((entry) => {
            if (ts.isSpreadElement(entry)) {
                fail(file, entry, 'manifest arrays may not contain spreads');
            }
            return evaluate(file, entry);
        });
    }
    if (ts.isObjectLiteralExpression(node)) {
        const value = {};
        for (const property of node.properties) {
            if (!ts.isPropertyAssignment(property)) {
                fail(
                    file,
                    property,
                    'manifest objects may contain only explicit property assignments'
                );
            }
            value[propertyName(file, property.name)] = evaluate(
                file,
                property.initializer
            );
        }
        return value;
    }
    fail(
        file,
        node,
        'manifest values must be static JSON-like literals; runtime expressions are forbidden'
    );
}

/** Read a template manifest without executing template-owned code. */
export function readTemplateManifest(file) {
    const ts = requireCompiler();
    const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const variables = new Map();
    let exported;
    for (const statement of source.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name) && declaration.initializer) {
                    variables.set(declaration.name.text, declaration.initializer);
                }
            }
        }
        if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
            exported = statement.expression;
        }
    }
    if (!exported) throw new Error(`${file}: default manifest export is required`);
    exported = unwrap(exported);
    if (ts.isIdentifier(exported)) {
        const initializer = variables.get(exported.text);
        if (!initializer) {
            fail(file, exported, `manifest variable "${exported.text}" was not found`);
        }
        exported = initializer;
    }
    const manifest = evaluate(file, exported);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error(`${file}: default manifest export must be an object`);
    }
    return manifest;
}

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate deploy-owned values against the selected template declaration. */
export function operationalBindingDeclarationIssues(bindings, manifest) {
    if (!isRecord(manifest)) return ['selected template manifest must be an object'];
    let validated;
    try {
        validated = validateOperationalBindings(bindings);
    } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
    }
    const keys = listOperationalBindingKeys(validated);
    const errors = [];
    const declarations = Array.isArray(manifest.operationalBindings)
        ? manifest.operationalBindings
        : [];
    const declared = new Map(declarations.map((entry) => [entry?.key, entry]));
    for (const key of keys) {
        const declaration = declared.get(key);
        if (!declaration) {
            errors.push(
                `operational binding "${key}" is not declared by the selected template`
            );
        } else if (declaration.type !== OPERATIONAL_BINDING_SPECS[key].type) {
            errors.push(
                `operational binding "${key}" must be declared as ${OPERATIONAL_BINDING_SPECS[key].type}`
            );
        } else if (declaration.locked !== true) {
            errors.push(`operational binding "${key}" must be locked`);
        }
    }
    for (const declaration of declarations) {
        const spec = OPERATIONAL_BINDING_SPECS[declaration?.key];
        if (!spec) {
            errors.push(
                `template declares unknown operational binding "${declaration?.key}"`
            );
            continue;
        }
        if (declaration.type !== spec.type) {
            errors.push(
                `operational binding "${declaration.key}" must be declared as ${spec.type}`
            );
        }
        if (declaration.locked !== true) {
            errors.push(
                `operational binding "${declaration.key}" must be locked`
            );
        }
        if (declaration?.required && !keys.includes(declaration.key)) {
            errors.push(
                `required operational binding "${declaration.key}" is missing`
            );
        }
    }
    return errors;
}
