// When each Host SDK name arrived, and when a deprecated one leaves.
//
// Every exposed name is a promise, and until now nothing recorded when a
// promise was made, so no template author could tell what is safe against the
// Fleet a customer is actually running.
//
// This file is a ledger, not a pure derivation: it reads its own previous
// output and keeps the `since` already recorded, because the version a name
// arrived in cannot be read back out of the source. Only the name set is
// derived. A name the ledger has never seen is stamped with the Fleet version
// generating this run, and a name that has stopped being exported keeps its
// row with `removedIn` set, because a withdrawn promise is the one an author
// most needs to find.

import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import {HOST_DIR, parseSource, sdkSourceFiles} from './_hostSdkSource.js';
import {GENERATED_DIR, mdEscape, REPO_ROOT, relPath} from './_shared.js';

/** Every specifier a template may import, mapped to the file it resolves to. */
const ENTRYPOINTS: Readonly<Record<string, string>> = {
    '@host': 'index.ts',
    '@host/api': 'api.ts',
    '@host/core': 'core/index.ts',
    '@host/react': 'react/index.ts',
    '@host/vue': 'vue/index.ts'
};

// The sentence a deprecation must carry. Without a version a deprecation says
// only "we would rather you did not", which nobody has to act on.
const REMOVAL_PATTERN = /Removed in Fleet (\d+\.\d+(?:\.\d+)?)/;

export interface HostSdkSurfaceName {
    name: string;
    /** `type` only when every entrypoint exports it type-only. */
    kind: 'value' | 'type';
    entrypoints: string[];
    /** The Fleet version that first recorded this name. */
    since: string;
    /** Set the run after the name stopped being exported. */
    removedIn?: string;
}

export interface HostSdkDeprecation {
    /** `<module>.<member>`, the way a template writes it. */
    id: string;
    file: string;
    line: number;
    /** The Fleet version that removes it. */
    removeIn: string;
    note: string;
}

export interface HostSdkChangelog {
    generator: 'host-sdk-changelog';
    version: 1;
    summary: {
        rule: string;
        /** The version this ledger began at; earlier rows say "at or before". */
        baselineVersion: string;
        entrypoints: Record<string, string>;
        nameCount: number;
        removedCount: number;
        deprecatedCount: number;
    };
    names: HostSdkSurfaceName[];
    deprecated: HostSdkDeprecation[];
}

const LEDGER_FILE = path.join(GENERATED_DIR, 'host-sdk-changelog.json');

/** One source for the running Fleet version: the field vite turns into
 *  NPM_APP_VERSION, and the same one every version gate already reads. */
function fleetVersion(): string {
    const pkg = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'frontend/package.json'), 'utf8')
    );
    if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
        throw new Error('frontend/package.json has no version');
    }
    return pkg.version;
}

function isExported(node: ts.Node): boolean {
    return ts.canHaveModifiers(node)
        ? (ts
              .getModifiers(node)
              ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
        : false;
}

function declarationName(name: ts.Node): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    return undefined;
}

/** Exported names of one entrypoint, with whether each is type-only. */
function entrypointExports(file: string): Map<string, boolean> {
    const source = parseSource(file);
    const out = new Map<string, boolean>();
    const add = (name: string, typeOnly: boolean): void => {
        // A name exported twice is a value if any of its exports is one.
        out.set(name, (out.get(name) ?? true) && typeOnly);
    };
    for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement)) {
            const clause = statement.exportClause;
            if (!clause || !ts.isNamedExports(clause)) {
                // A star re-export publishes the target's names; follow one hop.
                if (
                    !clause &&
                    statement.moduleSpecifier &&
                    ts.isStringLiteral(statement.moduleSpecifier) &&
                    statement.moduleSpecifier.text.startsWith('.')
                ) {
                    const base = path.resolve(
                        path.dirname(file),
                        statement.moduleSpecifier.text
                    );
                    for (const candidate of [
                        `${base}.ts`,
                        `${base}.tsx`,
                        path.join(base, 'index.ts')
                    ]) {
                        if (fs.existsSync(candidate)) {
                            for (const [name, typeOnly] of entrypointExports(
                                candidate
                            )) {
                                add(name, statement.isTypeOnly || typeOnly);
                            }
                            break;
                        }
                    }
                }
                continue;
            }
            for (const element of clause.elements) {
                add(
                    element.name.text,
                    statement.isTypeOnly || element.isTypeOnly
                );
            }
            continue;
        }
        if (!isExported(statement)) continue;
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                const name = declarationName(declaration.name);
                if (name) add(name, false);
            }
            continue;
        }
        if (
            ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            ts.isEnumDeclaration(statement)
        ) {
            const name = statement.name && declarationName(statement.name);
            if (name) add(name, false);
            continue;
        }
        if (
            ts.isTypeAliasDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement)
        ) {
            add(statement.name.text, true);
        }
    }
    return out;
}

function namedDeclaration(node: ts.Node): string | undefined {
    if (
        ts.isPropertySignature(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isMethodSignature(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isExportSpecifier(node)
    ) {
        return node.name ? declarationName(node.name) : undefined;
    }
    return undefined;
}

function tagText(tag: ts.JSDocTag): string {
    const comment = tag.comment;
    if (typeof comment === 'string') return comment;
    if (!comment) return '';
    return comment.map((part) => part.getText()).join('');
}

function deprecationsIn(file: string): HostSdkDeprecation[] {
    const source = parseSource(file);
    const module = path.basename(file, '.ts');
    const out: HostSdkDeprecation[] = [];
    const seen = new Set<string>();
    const visit = (node: ts.Node): void => {
        for (const tag of ts.getJSDocTags(node)) {
            if (tag.tagName.text !== 'deprecated') continue;
            const member = namedDeclaration(node);
            if (!member) continue;
            const line =
                source.getLineAndCharacterOfPosition(node.getStart(source))
                    .line + 1;
            const id = `${module}.${member}`;
            const key = `${id}@${line}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const note = tagText(tag).replace(/\s+/g, ' ').trim();
            const removal = REMOVAL_PATTERN.exec(note);
            if (!removal) {
                throw new Error(
                    `${relPath(file)}:${line} @deprecated ${id} names no removal version. ` +
                        'Add "Removed in Fleet <version>." — a deprecation with no exit is only an opinion.'
                );
            }
            out.push({
                id,
                file: relPath(file),
                line,
                removeIn: removal[1],
                note
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
}

function readLedger(): HostSdkChangelog | null {
    if (!fs.existsSync(LEDGER_FILE)) return null;
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
}

export function generate(): HostSdkChangelog {
    const version = fleetVersion();
    const previous = readLedger();
    const baselineVersion = previous?.summary.baselineVersion ?? version;

    const live = new Map<string, {kind: 'value' | 'type'; entries: string[]}>();
    for (const [specifier, file] of Object.entries(ENTRYPOINTS)) {
        for (const [name, typeOnly] of entrypointExports(
            path.join(HOST_DIR, file)
        )) {
            const row = live.get(name) ?? {kind: 'type', entries: []};
            if (!typeOnly) row.kind = 'value';
            row.entries.push(specifier);
            live.set(name, row);
        }
    }

    const recorded = new Map(
        (previous?.names ?? []).map((row) => [row.name, row])
    );
    const names: HostSdkSurfaceName[] = [];
    for (const [name, row] of live) {
        const before = recorded.get(name);
        names.push({
            name,
            kind: row.kind,
            entrypoints: row.entries.sort(),
            // A name that came back keeps its first `since` and drops the
            // removal, so the ledger never claims it arrived twice.
            since: before?.since ?? version
        });
    }
    for (const row of recorded.values()) {
        if (live.has(row.name)) continue;
        names.push({...row, removedIn: row.removedIn ?? version});
    }
    names.sort((a, b) => a.name.localeCompare(b.name));

    const deprecated = sdkSourceFiles()
        .flatMap(deprecationsIn)
        .sort((a, b) => a.id.localeCompare(b.id));

    return {
        generator: 'host-sdk-changelog',
        version: 1,
        summary: {
            rule: 'Every exported name is a promise. Additive only; a deprecated name keeps working until the version its note names.',
            baselineVersion,
            entrypoints: ENTRYPOINTS,
            nameCount: names.filter((row) => !row.removedIn).length,
            removedCount: names.filter((row) => row.removedIn).length,
            deprecatedCount: deprecated.length
        },
        names,
        deprecated
    };
}

export function renderMarkdown(index: HostSdkChangelog): string {
    const {summary} = index;
    const live = index.names.filter((row) => !row.removedIn);
    const gone = index.names.filter((row) => row.removedIn);
    return [
        '# Host SDK Changelog',
        '',
        summary.rule,
        '',
        `Names on the surface: ${summary.nameCount}. Withdrawn: ${summary.removedCount}. Deprecated: ${summary.deprecatedCount}.`,
        '',
        `Generated. Never hand-edited — regenerate with \`cd backend && npm run generate\`.`,
        '',
        `A row reading \`${summary.baselineVersion}\` means "present when this ledger began", not "arrived then". ${summary.baselineVersion} is the first Fleet version that recorded anything here; every later version is exact.`,
        '',
        '## Entrypoints',
        '',
        '| Import | File |',
        '|---|---|',
        ...Object.entries(summary.entrypoints).map(
            ([specifier, file]) =>
                `| \`${mdEscape(specifier)}\` | \`${mdEscape(`frontend/src/shell/template-host/${file}`)}\` |`
        ),
        '',
        '## Deprecated, with the version that removes it',
        '',
        index.deprecated.length === 0
            ? 'None.'
            : [
                  '| Name | Removed in | Why | Source |',
                  '|---|---|---|---|',
                  ...index.deprecated.map(
                      (row) =>
                          `| \`${mdEscape(row.id)}\` | ${mdEscape(row.removeIn)} | ${mdEscape(row.note)} | \`${mdEscape(row.file)}:${row.line}\` |`
                  )
              ].join('\n'),
        '',
        '## Withdrawn names',
        '',
        gone.length === 0
            ? 'None. No name has been taken off the surface.'
            : [
                  '| Name | Added | Removed |',
                  '|---|---|---|',
                  ...gone.map(
                      (row) =>
                          `| \`${mdEscape(row.name)}\` | ${mdEscape(row.since)} | ${mdEscape(String(row.removedIn))} |`
                  )
              ].join('\n'),
        '',
        '## The surface, and when each name arrived',
        '',
        '| Name | Kind | Added | Entrypoints |',
        '|---|---|---|---|',
        ...live.map(
            (row) =>
                `| \`${mdEscape(row.name)}\` | ${row.kind} | ${mdEscape(row.since)} | ${mdEscape(row.entrypoints.join(', '))} |`
        ),
        ''
    ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(JSON.stringify(generate(), null, 2));
}
