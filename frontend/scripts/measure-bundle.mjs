// Reliable bundle-weight report. Run after `vite build --sourcemap`.
//   node scripts/measure-bundle.mjs
// Prints the first-paint (eager) total and attributes each eager chunk to its
// heaviest packages, so before/after numbers are always reproducible.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';

const ASSETS = 'dist/assets';

function firstPaintChunks() {
    const html = readFileSync('dist/index.html', 'utf8');
    const hits = [...html.matchAll(/assets\/([^"']+\.js)/g)].map((m) => m[1]);
    return [...new Set(hits)];
}

function gzKb(buf) {
    return Math.round(gzipSync(buf).length / 1024);
}

function topPackages(jsFile) {
    const mapPath = join(ASSETS, `${jsFile}.map`);
    if (!existsSync(mapPath)) return null;
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    const bytes = {};
    (map.sources || []).forEach((src, i) => {
        const len = (map.sourcesContent?.[i] || '').length;
        const pkg = src.match(/node_modules\/(?:\.pnpm\/)?(@[^/]+\/[^/]+|[^/]+)/);
        const key = pkg ? pkg[1] : 'src/(app code)';
        bytes[key] = (bytes[key] || 0) + len;
    });
    return Object.entries(bytes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
}

function report() {
    let total = 0;
    console.log('── first-paint (eager) chunks ──');
    for (const file of firstPaintChunks()) {
        const path = join(ASSETS, file);
        if (!existsSync(path)) continue;
        const kb = gzKb(readFileSync(path));
        total += kb;
        console.log(`${`${kb}KB gz`.padStart(9)}  ${file}`);
    }
    console.log(`── FIRST-PAINT TOTAL: ${total} KB gz ──\n`);

    for (const file of firstPaintChunks()) {
        const top = topPackages(file);
        if (!top) continue;
        console.log(`── ${file} — heaviest sources (raw KB) ──`);
        for (const [key, len] of top) {
            console.log(`${`${Math.round(len / 1024)}KB`.padStart(8)}  ${key}`);
        }
        console.log();
    }
}

report();
