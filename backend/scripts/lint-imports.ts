// Enforces the convention "all static imports/exports at the top of the file"
// across backend src/ + scripts/. Dynamic `await import()` is exempt.
// Run as a Phase 0a CI gate; exits non-zero on the first violation.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

interface Violation {
    file: string;
    line: number;
    text: string;
}

const ROOTS = ['src', 'scripts'];

function walk(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules') continue;
            walk(p, out);
        } else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) {
            out.push(p);
        }
    }
}

function audit(file: string, out: Violation[]): void {
    const src = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    let firstNonImport = -1;
    for (const stmt of sf.statements) {
        const isImport =
            ts.isImportDeclaration(stmt) ||
            ts.isImportEqualsDeclaration(stmt) ||
            (ts.isExportDeclaration(stmt) && !!stmt.moduleSpecifier);
        if (firstNonImport === -1) {
            if (!isImport) firstNonImport = stmt.getStart();
        } else if (isImport) {
            const ln =
                sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;
            out.push({
                file,
                line: ln,
                text: stmt.getText(sf).split('\n')[0]
            });
        }
    }
}

function main(): void {
    const cwd = process.cwd();
    const files: string[] = [];
    for (const r of ROOTS) walk(path.join(cwd, r), files);
    const violations: Violation[] = [];
    for (const f of files) audit(f, violations);
    if (violations.length === 0) {
        console.log(
            `[PASS] All ${files.length} TS files keep imports at the top.`
        );
        return;
    }
    console.log(
        `[FAIL] ${violations.length} mid-file static import(s) across ${new Set(violations.map((v) => v.file)).size} file(s):`
    );
    for (const v of violations) {
        const rel = path.relative(cwd, v.file);
        console.log(`  ${rel}:${v.line}: ${v.text}`);
    }
    console.log('');
    console.log(
        'Move all static imports/exports to the top block. Use `await import(...)` if you need lazy/circular-break loading.'
    );
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
