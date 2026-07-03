import fs from 'node:fs';
import path from 'node:path';

const sourceDir = path.resolve(process.argv[2] ?? '../template-source');
const template = process.argv[3] ?? '';
const customizationFile = process.argv[4]
    ? path.resolve(process.argv[4])
    : '';

const REQUIRED_CONTRACTS = [
    'host.ts',
    'manifest.ts',
    'overrides.ts',
    'mutations.ts',
    'index.ts'
];
const BASE_OVERRIDE_KEYS = new Set(['schemaVersion', 'clientName']);

function fail(message) {
    console.error(`Template package validation failed: ${message}`);
    process.exit(1);
}

function readFile(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        fail(`cannot read ${file}`);
    }
}

function readJson(file) {
    try {
        return JSON.parse(readFile(file));
    } catch (err) {
        fail(`invalid JSON in ${file}: ${err.message}`);
    }
}

function matchString(source, key) {
    const match = source.match(
        new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`, 'm')
    );
    return match?.[1] ?? '';
}

function matchScalar(source, key) {
    const quoted = matchString(source, key);
    if (quoted) return quoted;
    const match = source.match(new RegExp(`${key}\\s*:\\s*([0-9]+)`, 'm'));
    return match?.[1] ?? '';
}

function matchStringArray(source, key) {
    const match = source.match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'm'));
    if (!match) return [];
    return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

if (!template) fail('template name argument is required');
if (!fs.existsSync(sourceDir)) fail(`template source not found: ${sourceDir}`);

const contractsDir = path.join(sourceDir, 'contracts');
if (!fs.existsSync(contractsDir)) fail('contracts/ is required');
for (const file of REQUIRED_CONTRACTS) {
    const full = path.join(contractsDir, file);
    if (!fs.existsSync(full)) fail(`contracts/${file} is required`);
}
if (fs.existsSync(path.join(sourceDir, 'types'))) {
    fail('types/ is not allowed; use contracts/');
}
if (fs.existsSync(path.join(sourceDir, 'shared/types'))) {
    fail('shared/types/ is not allowed; use contracts/');
}

const templateDir = path.join(sourceDir, 'templates', template);
const indexFile = path.join(templateDir, 'index.vue');
const manifestFile = path.join(templateDir, 'manifest.ts');
if (!fs.existsSync(indexFile)) fail(`templates/${template}/index.vue is required`);
if (!fs.existsSync(manifestFile)) fail(`templates/${template}/manifest.ts is required`);

const manifestSource = readFile(manifestFile);
const manifestId =
    matchString(manifestSource, 'id') || matchString(manifestSource, 'name');
const manifestVersion =
    matchScalar(manifestSource, 'manifestVersion') ||
    matchScalar(manifestSource, 'version');
const overridesSchemaVersion =
    matchScalar(manifestSource, 'overridesSchemaVersion') || '1';

if (manifestId !== template) {
    fail(`manifest id must be "${template}", got "${manifestId || '<missing>'}"`);
}
if (!manifestVersion) {
    fail('manifest must declare manifestVersion or version');
}
if (!/^[0-9]+$/.test(String(overridesSchemaVersion))) {
    fail('overridesSchemaVersion must be numeric');
}

if (customizationFile) {
    const customization = readJson(customizationFile);
    const schemaVersion = String(customization.schemaVersion ?? '1');
    if (schemaVersion !== String(overridesSchemaVersion)) {
        fail(
            `customization schemaVersion ${schemaVersion} does not match manifest overridesSchemaVersion ${overridesSchemaVersion}`
        );
    }
    const allowedOverrideKeys = matchStringArray(manifestSource, 'allowedOverrideKeys');
    if (allowedOverrideKeys.length > 0) {
        const allowed = new Set([...BASE_OVERRIDE_KEYS, ...allowedOverrideKeys]);
        for (const key of Object.keys(customization)) {
            if (!allowed.has(key)) {
                fail(`customization key "${key}" is not allowed by manifest`);
            }
        }
    }
}

console.log(
    `Template package validation passed: ${template}@${manifestVersion}`
);
