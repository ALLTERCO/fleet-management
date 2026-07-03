import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const scannedRoots = ['frontend/src/pages', 'frontend/src/components'];
const forbiddenCalls = ['Mobile.GetBootstrap', 'Mobile.SyncDelta'];

interface Violation {
    file: string;
    line: number;
    call: string;
}

function listSourceFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    return entries.flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listSourceFiles(fullPath);
        if (/\.(ts|vue)$/.test(entry.name)) return [fullPath];
        return [];
    });
}

function findViolations(file: string): Violation[] {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const violations: Violation[] = [];
    lines.forEach((lineText, index) => {
        for (const call of forbiddenCalls) {
            if (lineText.includes(call)) {
                violations.push({file: rel, line: index + 1, call});
            }
        }
    });
    return violations;
}

function main(): void {
    const violations = scannedRoots.flatMap((root) =>
        listSourceFiles(path.join(repoRoot, root)).flatMap(findViolations)
    );
    if (violations.length === 0) {
        console.log('[PASS] shared refresh transports stay behind stores');
        return;
    }
    console.log(
        `[FAIL] ${violations.length} shared refresh transport boundary violation(s):`
    );
    for (const violation of violations) {
        console.log(`  ${violation.file}:${violation.line}: ${violation.call}`);
    }
    process.exit(1);
}

main();
