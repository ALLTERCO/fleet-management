#!/usr/bin/env node
// Reports .vue files that contain interactive elements (button / link /
// input[type=submit|button]) but DO NOT reference --touch-target-min,
// `touch-target` utility class, or min-height >= 44px / 2.75rem anywhere
// in the file. Candidates for manual review against Phase A.5.
//
// Does NOT fail CI — many false positives are inevitable (icon-buttons
// inside parent containers that already meet the 44px minimum).
// Intended as a periodic candidate list, not a gate.

import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;

const INTERACTIVE_PATTERNS = [
    /<button\b/,
    /<input\b[^>]*type=['"](?:button|submit|reset)['"]/i,
    /<a\b[^>]*class=['"]/
];

const TOUCH_HINT_PATTERNS = [
    /--touch-target-min/,
    /\btouch-target\b/,
    /min-height\s*:\s*(?:44px|2\.75rem|3rem|46px|48px)/,
    /min-width\s*:\s*(?:44px|2\.75rem|3rem|46px|48px)/
];

function walk(dir, files) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const stat = statSync(p);
        if (stat.isDirectory()) {
            if (entry === 'node_modules' || entry === 'dist') continue;
            walk(p, files);
        } else if (p.endsWith('.vue')) {
            files.push(p);
        }
    }
}

function inspect(file) {
    const text = readFileSync(file, 'utf8');
    const hasInteractive = INTERACTIVE_PATTERNS.some((p) => p.test(text));
    if (!hasInteractive) return null;
    const hasHint = TOUCH_HINT_PATTERNS.some((p) => p.test(text));
    if (hasHint) return null;
    return relative(process.cwd(), file);
}

const files = [];
walk(ROOT, files);
const candidates = [];
for (const f of files) {
    const flag = inspect(f);
    if (flag) candidates.push(flag);
}

if (candidates.length === 0) {
    console.log(
        `[OK] ${files.length} .vue files scanned — no touch-target candidates.`
    );
    process.exit(0);
}

console.log(
    `[INFO] ${candidates.length} of ${files.length} .vue files have interactive elements but no touch-target hint.`
);
console.log('Manual review against Phase A.5 (≥44px hit targets):');
console.log('');
for (const f of candidates) console.log(`  ${f}`);
console.log('');
console.log(
    'Many will be false positives (icon-button inside a 44px+ row, etc.). Triage manually.'
);
