// Customer-facing API reference: Scalar viewer wrapped in branded landing.
// Entry point only — data/css/sections/renderers live in sibling api-scalar-*.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {BACKEND_ROOT, GENERATED_DIR, relPath} from './_shared.js';
import {buildGuidesMarkdown} from './api-guides.js';
import {PAGE_CSS} from './api-scalar-css.js';
import {
    CATEGORIES,
    FAVICON_DATA_URI,
    SCALAR_CONFIGURATION,
    SPEC_INTRO_MARKDOWN
} from './api-scalar-data.js';
import {
    assertCategoryCoverage,
    categoryGrid,
    featuredCards,
    methodCountsByNamespace,
    renderBootScripts,
    renderCategoriesSection,
    renderFeaturedSection,
    renderFooter,
    renderHero,
    renderReferenceSection,
    renderStats,
    renderTopbar,
    safeJsonForScript
} from './api-scalar-renderers.js';
import {
    SECTION_AUTH_HTML,
    SECTION_QUICKSTART_HTML,
    SECTION_RESOURCES_HTML,
    SECTION_SPLASH_HTML,
    SECTION_TRANSPORT_HTML
} from './api-scalar-sections.js';
import type {OpenApiSpec, PageContext} from './api-scalar-types.js';

const SPEC_PATH = path.join(GENERATED_DIR, 'api.openapi.json');
const OUT_PATH = path.join(GENERATED_DIR, 'api.html');
const SCALAR_BUNDLE_PATH = path.join(
    BACKEND_ROOT,
    'node_modules/@scalar/api-reference/dist/browser/standalone.js'
);

function ensureScalarInstalled(): void {
    if (fs.existsSync(SCALAR_BUNDLE_PATH)) return;
    throw new Error(
        '@scalar/api-reference is not installed. Add it as a devDependency:\n' +
            '  cd backend && npm install --save-dev @scalar/api-reference'
    );
}

function ensureSpecExists(): void {
    if (fs.existsSync(SPEC_PATH)) return;
    throw new Error(
        `${relPath(SPEC_PATH)} missing. Run \`npm run generate\` first.`
    );
}

// Group the namespace tags by category so Scalar's sidebar nests the reference
// instead of listing 127 tags flat. Built from the same CATEGORIES the landing
// grid uses; any namespace not in a category falls into a trailing "Other"
// group so no operation is hidden.
function buildTagGroups(
    spec: OpenApiSpec
): Array<{name: string; tags: string[]}> {
    const specTags = new Set((spec.tags ?? []).map((t) => t.name));
    const grouped = new Set<string>();
    const groups: Array<{name: string; tags: string[]}> = [];
    for (const cat of CATEGORIES) {
        const tags = cat.namespaces.filter((ns) => specTags.has(ns));
        for (const ns of tags) grouped.add(ns);
        if (tags.length) groups.push({name: cat.label, tags});
    }
    const other = [...specTags].filter((n) => !grouped.has(n)).sort();
    if (other.length) groups.push({name: 'Other', tags: other});
    return groups;
}

// Returns a new spec — never mutates input. The landing keeps its own curated
// intro (SPEC_INTRO_MARKDOWN), then appends the handwritten guides so Scalar
// renders them as sidebar pages on the served /api/docs page.
function decorateSpec(spec: OpenApiSpec): OpenApiSpec {
    return {
        ...spec,
        info: {
            ...(spec.info ?? {}),
            title: 'Fleet Manager API',
            description: [SPEC_INTRO_MARKDOWN, buildGuidesMarkdown()]
                .filter(Boolean)
                .join('\n\n')
        },
        'x-tagGroups': buildTagGroups(spec)
    };
}

function pageContext(spec: OpenApiSpec): PageContext {
    const counts = methodCountsByNamespace(spec);
    assertCategoryCoverage(counts);
    return {
        version: spec.info?.version ?? '',
        methodCount: Object.keys(spec.paths ?? {}).length,
        nsCount: counts.size,
        catCount: CATEGORIES.length,
        featured: featuredCards(counts),
        categories: categoryGrid(counts),
        specJson: safeJsonForScript(spec),
        cfgJson: safeJsonForScript(JSON.stringify(SCALAR_CONFIGURATION))
    };
}

function renderHtml(spec: OpenApiSpec, scalarJs: string): string {
    const ctx = pageContext(spec);
    return [
        '<!doctype html>',
        '<html lang="en" class="fm-light">',
        '<head>',
        '  <meta charset="utf-8" />',
        '  <meta name="viewport" content="width=device-width,initial-scale=1" />',
        '  <meta name="color-scheme" content="light dark" />',
        '  <meta name="theme-color" content="#4495D1" />',
        `  <link rel="icon" href="${FAVICON_DATA_URI}" />`,
        '  <title>Fleet Manager — API Reference</title>',
        `  <style>${PAGE_CSS}</style>`,
        '</head>',
        '<body>',
        SECTION_SPLASH_HTML,
        '  <div class="fm-page">',
        renderTopbar(ctx.version),
        renderHero(ctx),
        renderStats(ctx),
        renderFeaturedSection(ctx.featured),
        renderCategoriesSection(ctx),
        SECTION_AUTH_HTML,
        SECTION_TRANSPORT_HTML,
        SECTION_QUICKSTART_HTML,
        SECTION_RESOURCES_HTML,
        renderReferenceSection(ctx),
        renderFooter(ctx.version),
        '  </div>',
        renderBootScripts(scalarJs, ctx.cfgJson),
        '</body>',
        '</html>'
    ].join('\n');
}

export function buildHtml(): void {
    ensureScalarInstalled();
    ensureSpecExists();
    const scalarJs = fs.readFileSync(SCALAR_BUNDLE_PATH, 'utf8');
    const spec = decorateSpec(
        JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8')) as OpenApiSpec
    );
    const html = renderHtml(spec, scalarJs);
    fs.writeFileSync(OUT_PATH, html);
    const sizeMb = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`[api-scalar] wrote ${relPath(OUT_PATH)} (${sizeMb} MB)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    buildHtml();
}
