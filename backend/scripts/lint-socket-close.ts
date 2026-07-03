// CI gate: forbid direct socket.on/once('close') outside ConnectionContext.

import * as fs from 'node:fs';
import * as path from 'node:path';

interface Violation {
    file: string;
    line: number;
    text: string;
}

const ROOTS = ['src'];
const ALLOWLIST = new Set(['src/modules/web/ws/ConnectionContext.ts']);
const PATTERN = /\bsocket\.(on|once)\(\s*['"]close['"]/;

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

function audit(file: string, relPath: string, out: Violation[]): void {
    if (ALLOWLIST.has(relPath)) return;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const code = lines[i].replace(/\/\/.*$/, '');
        if (PATTERN.test(code)) {
            out.push({file: relPath, line: i + 1, text: lines[i].trim()});
        }
    }
}

function main(): void {
    const cwd = process.cwd();
    const files: string[] = [];
    for (const r of ROOTS) walk(path.join(cwd, r), files);
    const violations: Violation[] = [];
    for (const f of files) {
        const rel = path.relative(cwd, f);
        audit(f, rel, violations);
    }
    if (violations.length === 0) {
        console.log(
            `[PASS] No direct socket.on/once('close') outside ConnectionContext (${files.length} files scanned).`
        );
        return;
    }
    console.log(
        `[FAIL] ${violations.length} direct socket.on/once('close') call(s) outside ConnectionContext:`
    );
    for (const v of violations) {
        console.log(`  ${v.file}:${v.line}: ${v.text}`);
    }
    console.log('');
    console.log(
        'Per-socket cleanup belongs on ctx.onClose so the connection lifecycle owner is the single source of truth.'
    );
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
