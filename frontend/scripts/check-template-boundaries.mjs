import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
    allowedImportsFor,
    allowedSharedImports,
    forbiddenFrameworkImport,
    isAllowedImport
} from '../src/shell/template-contract.ts';
import {
    checkHostVersionFloor,
    hostVersionFloorMessage
} from '../src/shell/template-host/core/host-version.ts';
import {isCliEntry} from './lib/cli-entry.mjs';
import {
    readTemplateEntryDeclaration,
    resolveTemplateEntry
} from './lib/template-entry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TEMPLATE_DIR = 'src/template-active';
// Each renderer publishes its own entrypoint, so a required export only counts
// as published when the index that renderer actually ships carries it.
const HOST_MODULE_BY_RENDERER = {
    vue: {
        '@host': path.join(ROOT, 'src/shell/template-host/index.ts'),
        '@host/api': path.join(ROOT, 'src/shell/template-host/api.ts'),
        '@host/vue': path.join(ROOT, 'src/shell/template-host/vue/index.ts')
    },
    react: {
        '@host': path.join(ROOT, 'src/shell/template-host/react/index.ts'),
        '@host/api': path.join(ROOT, 'src/shell/template-host/api.ts'),
        '@host/react': path.join(ROOT, 'src/shell/template-host/react/index.ts')
    }
};
// One source for the running Fleet version: the same package.json field
// vite.config.ts turns into NPM_APP_VERSION.
const FLEET_VERSION = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
).version;

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

function walk(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walk(full));
        else if (/\.(vue|ts|tsx|js|mjs|css)$/.test(entry.name))
            files.push(full);
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
    const match = source.match(
        new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'm')
    );
    if (!match) return [];
    return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

// A manifest is read as text here, never executed, so a floor that is not a
// plain quoted literal is returned raw and refused as an unreadable version
// rather than passing as "no floor declared".
function readVersionLiteral(source, key) {
    const declared = source.match(new RegExp(`\\b${key}\\s*:\\s*([^,\\n}]+)`));
    if (!declared) return undefined;
    const raw = declared[1].trim();
    const quoted = raw.match(/^['"]([^'"]*)['"]$/);
    return quoted ? quoted[1] : raw;
}

function readRequiredHostExports(source) {
    return [
        ...readStringArray(source, 'requiredHostExports'),
        ...readStringArray(source, 'requiredHostComposables')
    ];
}

// A manifest declares its entry repo-relative ("templates/oasis/index.vue"),
// so the source root is the directory holding `templates/`. dev-server.sh
// links src/template-active at the template itself, and path.resolve does not
// follow links — without realpath the parent reads as "src", the root comes
// back null, and every symlinked template fails as "entry not found".
function templateSourceRoot(templateDir) {
    let real = templateDir;
    try {
        real = fs.realpathSync(templateDir);
    } catch {
        // Not present yet; fall through and let the caller report it.
    }
    const parent = path.dirname(real);
    if (path.basename(parent) !== 'templates') return null;
    return path.dirname(parent);
}

function withoutComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function exportedNames(file) {
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    const names = new Set();
    for (const match of source.matchAll(
        /\bexport\s+(?:type\s+)?\{([\s\S]*?)\}\s*(?:from\s*['"][^'"]+['"])?/g
    )) {
        for (const item of match[1].split(',')) {
            const declaration = item.trim().replace(/^type\s+/, '');
            if (!declaration) continue;
            const parts = declaration.split(/\s+as\s+/);
            names.add((parts[1] ?? parts[0]).trim());
        }
    }
    for (const match of source.matchAll(
        /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
    )) {
        names.add(match[1]);
    }
    return names;
}

function hasHostExport(requirement, renderer) {
    const separator = requirement.lastIndexOf(':');
    if (separator < 1 || separator === requirement.length - 1) return false;
    const module = requirement.slice(0, separator);
    const name = requirement.slice(separator + 1);
    const moduleFile = HOST_MODULE_BY_RENDERER[renderer][module];
    return Boolean(moduleFile && exportedNames(moduleFile).has(name));
}

function cssSources(file, source) {
    if (file.endsWith('.css')) return [source];
    if (!file.endsWith('.vue')) return [];
    return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
        (match) => match[1]
    );
}

function checkCssReferences(file, source, options) {
    const errors = [];
    for (const css of cssSources(file, source)) {
        const references = [
            ...[
                ...css.matchAll(
                    /@import\s+(?:url\(\s*)?['"]?([^'"\s);]+)['"]?\s*\)?/gi
                )
            ].map((match) => ({kind: '@import', value: match[1]})),
            ...[...css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)].map(
                (match) => ({kind: 'url()', value: match[1]})
            )
        ];
        for (const {kind, value} of references) {
            if (value.startsWith('#')) continue;
            if (
                /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value) ||
                value.includes('\\')
            ) {
                errors.push(
                    `${path.relative(ROOT, file)} uses forbidden CSS ${kind} target ${value}`
                );
                continue;
            }
            const target = path.resolve(
                path.dirname(file),
                value.split(/[?#]/)[0]
            );
            if (!isInside(options.rootDir, target)) {
                errors.push(
                    `${path.relative(ROOT, file)} CSS ${kind} escapes ${options.label}: ${value}`
                );
            }
        }
    }
    return errors;
}

function checkImportsInFiles(files, options) {
    const errors = [];
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        errors.push(...checkCssReferences(file, source, options));
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
            const framework = forbiddenFrameworkImport(specifier);
            if (framework) {
                errors.push(
                    `${path.relative(ROOT, file)} imports ${specifier}: ${framework.reason}`
                );
                continue;
            }
            if (isAllowedImport(specifier, options.allowedImports)) continue;
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

export function checkTemplateBoundaries(templateArg = '') {
    const errors = [];
    const warnings = [];
    const templateDir = path.resolve(ROOT, templateArg || DEFAULT_TEMPLATE_DIR);
    const manifestPath = path.join(templateDir, 'manifest.ts');
    const sourceRoot = templateSourceRoot(templateDir);
    if (!templateArg && !isClientBuild && !fs.existsSync(templateDir)) {
        return {
            skipped: true,
            templateDir,
            errors,
            warnings
        };
    }
    if (!fs.existsSync(manifestPath)) errors.push('missing manifest.ts');
    if (errors.length) return {skipped: false, templateDir, errors, warnings};

    const resolvedEntry = resolveTemplateEntry({
        sourceDir: sourceRoot ?? templateDir,
        templateDir,
        ...readTemplateEntryDeclaration(fs.readFileSync(manifestPath, 'utf8'))
    });
    if (!resolvedEntry.ok) {
        return {
            skipped: false,
            templateDir,
            errors: [resolvedEntry.reason],
            warnings
        };
    }
    const allowedImports = allowedImportsFor(resolvedEntry.renderer);

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
        ...checkImportsInFiles(walk(templateDir), {
            rootDir: templateDir,
            label: 'template',
            forbidHost: false,
            allowedImports
        })
    );

    if (sourceRoot) {
        const sharedDir = path.join(sourceRoot, 'shared');
        if (fs.existsSync(sharedDir)) {
            errors.push(
                ...checkImportsInFiles(walk(sharedDir), {
                    rootDir: sharedDir,
                    label: 'shared',
                    forbidHost: true,
                    // Shared code is renderer-neutral view models and helpers;
                    // it may use either renderer's runtime but never @host.
                    allowedImports: allowedSharedImports()
                })
            );
        }
    }

    const manifestSource = fs.readFileSync(manifestPath, 'utf8');
    // The floor the template declares, against the Fleet it is being built
    // into. Refusing here costs a build; refusing at the first failed call
    // costs a customer a broken screen. This is the gate a template author
    // runs, so it is where declaring no floor at all is said out loud.
    const floor = readVersionLiteral(manifestSource, 'minHostVersion');
    const floorVerdict = checkHostVersionFloor(FLEET_VERSION, floor);
    if (floorVerdict === 'no_floor') {
        warnings.push(hostVersionFloorMessage(FLEET_VERSION, floor));
    } else if (floorVerdict !== 'satisfied') {
        errors.push(hostVersionFloorMessage(FLEET_VERSION, floor));
    }

    for (const name of readRequiredHostExports(manifestSource)) {
        if (!hasHostExport(name, resolvedEntry.renderer)) {
            errors.push(`required host export is not exported: ${name}`);
        }
    }
    return {
        skipped: false,
        templateDir,
        errors,
        warnings,
        renderer: resolvedEntry.renderer
    };
}

function runCli() {
    const result = checkTemplateBoundaries(process.argv[2] ?? '');
    for (const warning of result.warnings)
        console.warn(`- warning: ${warning}`);
    if (result.errors.length) {
        console.error('Template boundary check failed:');
        for (const error of result.errors) console.error(`- ${error}`);
        process.exit(1);
    }
    if (result.skipped) {
        console.log(
            'Template boundary check skipped: no active template selected in host build'
        );
        process.exit(0);
    }
    console.log(
        `Template boundary check passed: ${path.relative(ROOT, result.templateDir)} (${result.renderer})`
    );
}

if (isCliEntry(import.meta.url)) {
    runCli();
}
