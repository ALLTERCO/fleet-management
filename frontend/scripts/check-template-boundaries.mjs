import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateArg = process.argv[2] ?? '';
const TEMPLATE_DIR = path.resolve(ROOT, templateArg || 'src/template-active');
const HOST_INDEX = path.join(ROOT, 'src/shell/template-host/index.ts');
const isExplicitTemplateCheck = templateArg.length > 0;
const isClientBuild =
    process.env.FM_BUILD_MODE === 'client' || process.env.MODE === 'client';

const FORBIDDEN_IMPORTS = [
    /^@\//,
    /^@\/stores(\/|$)/,
    /^@\/pages(\/|$)/,
    /^@\/layouts(\/|$)/,
    /^@\/router(\/|$)/,
    /^@\/tools(\/|$)/,
    /^@\/helpers(\/|$)/,
    /^@\/components(\/|$)/,
    /^@\/App(\.vue)?$/,
    /^\.\.\/.*stores/,
    /^\.\.\/.*pages/,
    /^\.\.\/.*layouts/
];

const ALLOWED_IMPORTS = [
    /^vue$/,
    /^vue-router$/,
    /^@host(\/|$)/,
    /^@template-contract(\/|$)/,
    /^@shared(\/|$)/,
    /^@vueuse\//,
    /^chart\.js$/,
    /^echarts$/,
    /^vue-echarts$/
];

function walk(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walk(full));
        else if (/\.(vue|ts|tsx|js|mjs)$/.test(entry.name)) files.push(full);
    }
    return files;
}

function importsFrom(source) {
    const imports = [];
    const importRe =
        /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importRe)) imports.push(match[1]);
    return imports;
}

function isInside(parent, child) {
    const relative = path.relative(parent, child);
    return (
        relative === '' ||
        (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
}

function readStringArray(source, key) {
    const match = source.match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'm'));
    if (!match) return [];
    return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

function readRequiredHostExports(manifestPath) {
    const source = fs.readFileSync(manifestPath, 'utf8');
    return [
        ...readStringArray(source, 'requiredHostExports'),
        ...readStringArray(source, 'requiredHostComposables')
    ];
}

function templateSourceRoot() {
    const parent = path.dirname(TEMPLATE_DIR);
    if (path.basename(parent) !== 'templates') return null;
    return path.dirname(parent);
}

function hasHostExport(name) {
    const source = fs.readFileSync(HOST_INDEX, 'utf8');
    return new RegExp(`\\b${name}\\b`).test(source);
}

function checkImportsInFiles(files, options) {
    const errors = [];
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        if (/\bimport\s*\(/.test(source)) {
            errors.push(`${path.relative(ROOT, file)} uses dynamic import()`);
        }
        for (const specifier of importsFrom(source)) {
            if (options.forbidHost && /^@host(\/|$)/.test(specifier)) {
                errors.push(
                    `${path.relative(ROOT, file)} imports forbidden ${specifier}`
                );
                continue;
            }
            if (ALLOWED_IMPORTS.some((rule) => rule.test(specifier))) continue;
            if (FORBIDDEN_IMPORTS.some((rule) => rule.test(specifier))) {
                errors.push(
                    `${path.relative(ROOT, file)} imports forbidden ${specifier}`
                );
                continue;
            }
            if (specifier.startsWith('.')) {
                const resolved = path.resolve(path.dirname(file), specifier);
                if (!isInside(options.rootDir, resolved)) {
                    errors.push(
                        `${path.relative(ROOT, file)} imports outside ${options.label} ${specifier}`
                    );
                }
                continue;
            }
            errors.push(`${path.relative(ROOT, file)} imports ${specifier}`);
        }
    }
    return errors;
}

function check() {
    const errors = [];
    const indexPath = path.join(TEMPLATE_DIR, 'index.vue');
    const manifestPath = path.join(TEMPLATE_DIR, 'manifest.ts');
    const sourceRoot = templateSourceRoot();
    if (
        !isExplicitTemplateCheck &&
        !isClientBuild &&
        !fs.existsSync(TEMPLATE_DIR)
    ) {
        return {
            skipped: true,
            errors
        };
    }
    if (!fs.existsSync(indexPath)) errors.push('missing index.vue');
    if (!fs.existsSync(manifestPath)) errors.push('missing manifest.ts');
    if (errors.length) return {skipped: false, errors};

    if (sourceRoot) {
        if (!fs.existsSync(path.join(sourceRoot, 'contracts'))) {
            errors.push('template source must contain contracts/');
        }
        if (fs.existsSync(path.join(sourceRoot, 'types'))) {
            errors.push('template source must not contain types/');
        }
        if (fs.existsSync(path.join(sourceRoot, 'shared/types'))) {
            errors.push('template source must not contain shared/types/');
        }
    }

    errors.push(
        ...checkImportsInFiles(walk(TEMPLATE_DIR), {
            rootDir: TEMPLATE_DIR,
            label: 'template',
            forbidHost: false
        })
    );

    if (sourceRoot) {
        const sharedDir = path.join(sourceRoot, 'shared');
        if (fs.existsSync(sharedDir)) {
            errors.push(
                ...checkImportsInFiles(walk(sharedDir), {
                    rootDir: sharedDir,
                    label: 'shared',
                    forbidHost: true
                })
            );
        }
    }

    for (const name of readRequiredHostExports(manifestPath)) {
        if (!hasHostExport(name)) {
            errors.push(`required host export is not exported: ${name}`);
        }
    }
    return {skipped: false, errors};
}

const result = check();
const errors = result.errors;
if (errors.length) {
    console.error('Template boundary check failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
}
if (result.skipped) {
    console.log(
        'Template boundary check skipped: no active template selected in host build'
    );
    process.exit(0);
}
console.log(`Template boundary check passed: ${path.relative(ROOT, TEMPLATE_DIR)}`);
