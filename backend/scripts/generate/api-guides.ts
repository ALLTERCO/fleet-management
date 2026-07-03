// Reads the handwritten narrative guides (getting-started, concepts, how-tos)
// and joins them into one markdown block for the OpenAPI `info.description`.
// Scalar renders that markdown into navigable sidebar pages, so these files
// are the durable home for integrator documentation on every instance's
// `/api/docs`. Kept a pure file read — deterministic (sorted filename order,
// no timestamps, no env) so `npm run generate:gates` stays stable.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {DOCS_DIR} from './_shared.js';

export const GUIDES_DIR = path.join(DOCS_DIR, 'api/guides');

// Inline `![alt](diagrams/x.svg)` as a base64 data URI: file refs don't resolve
// inside the spec, but images do.
const DIAGRAM_REF_RE = /!\[([^\]]*)\]\(diagrams\/([A-Za-z0-9_-]+\.svg)\)/g;

function inlineDiagrams(markdown: string, dir: string): string {
    return markdown.replace(DIAGRAM_REF_RE, (whole, alt, file) => {
        const svgPath = path.join(dir, 'diagrams', file);
        if (!fs.existsSync(svgPath)) return whole;
        const b64 = fs.readFileSync(svgPath).toString('base64');
        return `![${alt}](data:image/svg+xml;base64,${b64})`;
    });
}

// Ordering is lexicographic by filename; pages use numeric prefixes
// (`00-`, `10-`, …) to control their sidebar order. `_`-prefixed files are
// treated as drafts and skipped, matching the api-docs prose convention.
export function buildGuidesMarkdown(dir: string = GUIDES_DIR): string {
    if (!fs.existsSync(dir)) return '';
    const blocks = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
        .sort()
        .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim())
        .filter(Boolean);
    return inlineDiagrams(blocks.join('\n\n'), dir);
}
