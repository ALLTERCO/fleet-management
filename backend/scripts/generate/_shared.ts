/**
 * Shared helpers for Phase 0a baseline generators.
 *
 * Uses the TypeScript compiler API (ts.createProgram) for semantic analysis —
 * same tsconfig, same type resolution as the real backend build.
 *
 * All generators output both .md and .json siblings under docs/generated/
 * (at the repo root, NOT inside backend/).
 */

import {execSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

export const BACKEND_ROOT = path.resolve(__dirname, '../..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
export const BACKEND_SRC = path.join(BACKEND_ROOT, 'src');
export const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src');
export const DOCS_DIR = path.join(REPO_ROOT, 'docs');
export const GENERATED_DIR = path.join(DOCS_DIR, 'generated');

// --- TypeScript Program --------------------------------------------------

let cachedProgram: ts.Program | undefined;

/**
 * Build (or reuse) a TypeScript Program rooted at backend/tsconfig.json.
 * The Program gives us a full semantic view: type checker, symbol resolution,
 * decorator expressions fully parsed with metadata.
 */
export function getBackendProgram(): ts.Program {
    if (cachedProgram) return cachedProgram;
    const configPath = ts.findConfigFile(
        BACKEND_ROOT,
        ts.sys.fileExists,
        'tsconfig.json'
    );
    if (!configPath) {
        throw new Error('backend/tsconfig.json not found');
    }
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
    );
    cachedProgram = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options
    });
    return cachedProgram;
}

/** Get every source file that lives under backend/src/ */
export function getBackendSourceFiles(program: ts.Program): ts.SourceFile[] {
    return program
        .getSourceFiles()
        .filter(
            (sf) =>
                !sf.isDeclarationFile &&
                sf.fileName.startsWith(BACKEND_SRC + path.sep)
        )
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

// --- Decorator parsing ---------------------------------------------------

export interface ParsedDecorator {
    /** Left side of `@X.Y(...)` — e.g. `Component` in `@Component.Expose(...)` */
    namespace: string;
    /** Right side — e.g. `Expose` */
    name: string;
    /** Raw arguments as AST nodes */
    args: readonly ts.Expression[];
}

/** Parse `@Foo.Bar(args)` into {namespace, name, args}. Returns undefined for non-dotted decorators. */
export function parseDecorator(
    decorator: ts.Decorator
): ParsedDecorator | undefined {
    const expr = decorator.expression;
    if (!ts.isCallExpression(expr)) {
        if (ts.isPropertyAccessExpression(expr)) {
            const namespaceId = expr.expression;
            if (ts.isIdentifier(namespaceId)) {
                return {
                    namespace: namespaceId.text,
                    name: expr.name.text,
                    args: []
                };
            }
        }
        return undefined;
    }
    const callee = expr.expression;
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const namespaceId = callee.expression;
    if (!ts.isIdentifier(namespaceId)) return undefined;
    return {
        namespace: namespaceId.text,
        name: callee.name.text,
        args: expr.arguments
    };
}

/** Return parsed decorators for a node that can carry them */
export function decoratorsOf(node: ts.Node): ParsedDecorator[] {
    if (!ts.canHaveDecorators(node)) return [];
    const decorators = ts.getDecorators(node) ?? [];
    const parsed: ParsedDecorator[] = [];
    for (const d of decorators) {
        const p = parseDecorator(d);
        if (p) parsed.push(p);
    }
    return parsed;
}

/** Extract source text safely — for Program source files */
export function nodeText(node: ts.Node, source: ts.SourceFile): string {
    // source.text is sometimes lazily loaded when nodes come from a Program;
    // read the file directly if needed.
    const text = source.text ?? readFile(source.fileName);
    return text.slice(node.getStart(source), node.getEnd());
}

/** Read string-literal argument or return undefined */
export function readStringArg(
    node: ts.Expression | undefined
): string | undefined {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }
    return undefined;
}

// --- Location helpers ----------------------------------------------------

/** 1-based line number for a node — always pass source explicitly for Program nodes */
export function lineOf(node: ts.Node, source: ts.SourceFile): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Repo-relative path */
export function relPath(absolute: string): string {
    return path.relative(REPO_ROOT, absolute).replaceAll('\\', '/');
}

// --- File walking (for frontend scans where we don't need semantic info) --

export function walkFiles(dir: string, extensions: string[]): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, {withFileTypes: true});
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
                continue;
            }
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
                out.push(full);
            }
        }
    }
    return out.sort();
}

export function readFile(file: string): string {
    return fs.readFileSync(file, 'utf8');
}

// --- Output rendering ----------------------------------------------------

export function writeOutputs(
    baseName: string,
    json: unknown,
    markdown: string
): void {
    fs.mkdirSync(GENERATED_DIR, {recursive: true});
    const jsonPath = path.join(GENERATED_DIR, `${baseName}.json`);
    const mdPath = path.join(GENERATED_DIR, `${baseName}.md`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
    fs.writeFileSync(mdPath, markdown);
    console.log(
        `[${baseName}] wrote ${relPath(jsonPath)} + ${relPath(mdPath)}`
    );
}

export function gitSha(): string {
    try {
        return execSync('git rev-parse HEAD', {cwd: REPO_ROOT})
            .toString()
            .trim()
            .slice(0, 12);
    } catch {
        return 'unknown';
    }
}

export function provenanceHeader(title: string, sources: string[]): string {
    // Content-only; provenance lives in api.provenance.json.
    return [
        `# ${title}`,
        '',
        'Generated by `backend/scripts/generate/` — do not edit by hand.',
        'Regenerate with `cd backend && npm run generate`.',
        '',
        `- Sources: ${sources.map((s) => `\`${s}\``).join(', ')}`,
        '',
        '---',
        ''
    ].join('\n');
}

export function mdEscape(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/`/g, '\\`');
}

export function mdCodeInline(s: string): string {
    // Wrap in backticks; if it already contains backticks, use double-backtick fences
    if (s.includes('`')) return `\`\` ${s} \`\``;
    return `\`${s}\``;
}
