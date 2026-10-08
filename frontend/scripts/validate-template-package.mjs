import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';
import {findUnsafeCustomizationIssues} from '../src/shell/customization-safety.ts';
import {
    checkHostVersionFloor,
    hostVersionFloorMessage
} from '../src/shell/template-host/core/host-version.ts';
import {isCliEntry} from './lib/cli-entry.mjs';
import {resolveTemplateEntry} from './lib/template-entry.mjs';
import {
    operationalBindingDeclarationIssues,
    readTemplateManifest,
    useTypeScript
} from './lib/template-manifest.mjs';

// This package's own typescript; the shared parser has none of its own.
useTypeScript(ts);

const REQUIRED_CONTRACTS = [
    'host.ts',
    'manifest.ts',
    'overrides.ts',
    'mutations.ts',
    'index.ts'
];
const BASE_OVERRIDE_KEYS = new Set(['schemaVersion', 'clientName']);

function readFile(file) {
    return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
    return JSON.parse(readFile(file));
}

// Resolved through dirname like the sibling boundary checker, never
// `new URL(..., import.meta.url)`: Vite rewrites that pattern into an asset
// URL, so the same expression is a file path under node and not under vitest.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// One source for the running Fleet version: the same package.json field
// vite.config.ts turns into NPM_APP_VERSION. Read eagerly, so a Fleet that
// cannot find its own version fails here instead of accepting every template.
const RUNNING_FLEET_VERSION = readJson(path.join(ROOT, 'package.json')).version;

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadSafetyGate(sourceDir) {
    const registryDir = path.join(
        sourceDir,
        'shared/component-library/registry'
    );
    const validatePath = ['validate.ts', 'validate.mjs']
        .map((file) => path.join(registryDir, file))
        .find((file) => fs.existsSync(file));
    const blockPath = ['dashboard-block.ts', 'dashboard-block.mjs']
        .map((file) => path.join(registryDir, file))
        .find((file) => fs.existsSync(file));
    if (!validatePath || !blockPath) {
        return null;
    }
    const validateModule = await import(pathToFileURL(validatePath).href);
    const blockModule = await import(pathToFileURL(blockPath).href);
    if (
        typeof validateModule.validateCustomization !== 'function' ||
        typeof blockModule.resolveDashboardBlock !== 'function'
    ) {
        throw new Error(
            'safe component registry does not publish its validators'
        );
    }
    return {
        validateCustomization: validateModule.validateCustomization,
        resolveDashboardBlock: blockModule.resolveDashboardBlock
    };
}

async function validateCustomization(
    customization,
    manifest,
    sourceDir,
    suppliedGate
) {
    const errors = [];
    if (!isRecord(customization)) return ['customization must be an object'];

    const overridesSchemaVersion = manifest.overridesSchemaVersion ?? 1;
    const schemaVersion = String(customization.schemaVersion ?? '1');
    if (schemaVersion !== String(overridesSchemaVersion)) {
        errors.push(
            `customization schemaVersion ${schemaVersion} does not match manifest overridesSchemaVersion ${overridesSchemaVersion}`
        );
    }

    const allowedOverrideKeys = Array.isArray(manifest.allowedOverrideKeys)
        ? manifest.allowedOverrideKeys.filter((key) => typeof key === 'string')
        : [];
    const allowed = new Set([...BASE_OVERRIDE_KEYS, ...allowedOverrideKeys]);
    for (const key of Object.keys(customization)) {
        if (!allowed.has(key)) {
            errors.push(
                `customization key "${key}" is not allowed by manifest`
            );
        }
    }

    errors.push(...findUnsafeCustomizationIssues(customization));

    const gate = suppliedGate ?? (await loadSafetyGate(sourceDir));
    const needsRegistry =
        customization.components !== undefined ||
        customization.dashboardBlocks !== undefined ||
        customization.theme !== undefined;
    if (needsRegistry && !gate) {
        errors.push('safe component registry validators are required');
        return errors;
    }
    if (!gate) return errors;

    const patch = {};
    if (customization.components !== undefined) {
        patch.components = customization.components;
    }
    if (customization.theme !== undefined) patch.theme = customization.theme;
    for (const issue of gate.validateCustomization(patch)) {
        errors.push(
            `customization${issue.componentId ? ` component "${issue.componentId}"` : ''}.${issue.field}: ${issue.reason}`
        );
    }
    if (customization.dashboardBlocks !== undefined) {
        if (!Array.isArray(customization.dashboardBlocks)) {
            errors.push('customization.dashboardBlocks must be a list');
        } else {
            customization.dashboardBlocks.forEach((block, index) => {
                const result = gate.resolveDashboardBlock(block);
                if (!result.ok) {
                    for (const issue of result.issues) {
                        errors.push(
                            `customization.dashboardBlocks[${index}].${issue.field}: ${issue.reason}`
                        );
                    }
                }
            });
        }
    }
    return errors;
}

export async function validateTemplatePackage({
    sourceDir,
    template,
    customizationFile = '',
    operationalBindingsFile = '',
    safetyGate,
    hostVersion = RUNNING_FLEET_VERSION
}) {
    const errors = [];
    if (!template) return ['template name argument is required'];
    if (!fs.existsSync(sourceDir))
        return [`template source not found: ${sourceDir}`];

    const contractsDir = path.join(sourceDir, 'contracts');
    if (!fs.existsSync(contractsDir)) errors.push('contracts/ is required');
    for (const file of REQUIRED_CONTRACTS) {
        if (!fs.existsSync(path.join(contractsDir, file))) {
            errors.push(`contracts/${file} is required`);
        }
    }
    if (fs.existsSync(path.join(sourceDir, 'types'))) {
        errors.push('types/ is not allowed; use contracts/');
    }
    if (fs.existsSync(path.join(sourceDir, 'shared/types'))) {
        errors.push('shared/types/ is not allowed; use contracts/');
    }

    const templateDir = path.join(sourceDir, 'templates', template);
    const manifestFile = path.join(templateDir, 'manifest.ts');
    if (!fs.existsSync(manifestFile)) {
        errors.push(`templates/${template}/manifest.ts is required`);
        return errors;
    }
    let manifest;
    try {
        manifest = readTemplateManifest(manifestFile);
    } catch (error) {
        errors.push(`cannot read template manifest safely: ${error.message}`);
        return errors;
    }
    const resolved = resolveTemplateEntry({
        sourceDir,
        templateDir,
        kind: typeof manifest.kind === 'string' ? manifest.kind : '',
        renderer:
            typeof manifest.renderer === 'string' ? manifest.renderer : '',
        entry: typeof manifest.entry === 'string' ? manifest.entry : ''
    });
    if (!resolved.ok) errors.push(resolved.reason);

    const manifestId =
        typeof manifest.id === 'string'
            ? manifest.id
            : typeof manifest.name === 'string'
              ? manifest.name
              : '';
    const manifestVersion = manifest.manifestVersion ?? manifest.version;
    const overridesSchemaVersion = manifest.overridesSchemaVersion ?? 1;
    if (manifestId !== template) {
        errors.push(
            `manifest id must be "${template}", got "${manifestId || '<missing>'}"`
        );
    }
    if (!manifestVersion)
        errors.push('manifest must declare manifestVersion or version');
    if (!/^[0-9]+$/.test(String(overridesSchemaVersion))) {
        errors.push('overridesSchemaVersion must be numeric');
    }

    // The oldest Fleet this template says it supports, against the Fleet doing
    // the packaging. Every verdict but `no_floor` fails the package, including
    // a Fleet that cannot state its own version: a gate that cannot compare
    // has not passed anything. `no_floor` is reported by the authoring gate
    // (check-template-boundaries), not by a deploy-time log nobody reads.
    const floorVerdict = checkHostVersionFloor(
        hostVersion,
        manifest.minHostVersion
    );
    if (floorVerdict !== 'satisfied' && floorVerdict !== 'no_floor') {
        errors.push(
            hostVersionFloorMessage(hostVersion, manifest.minHostVersion)
        );
    }

    if (customizationFile) {
        try {
            errors.push(
                ...(await validateCustomization(
                    readJson(customizationFile),
                    manifest,
                    sourceDir,
                    safetyGate
                ))
            );
        } catch (error) {
            errors.push(`cannot validate customization: ${error.message}`);
        }
    }
    if (operationalBindingsFile) {
        try {
            errors.push(
                ...operationalBindingDeclarationIssues(
                    readJson(operationalBindingsFile),
                    manifest
                )
            );
        } catch (error) {
            errors.push(
                `cannot validate operational bindings: ${error.message}`
            );
        }
    }
    return errors;
}

async function runCli() {
    const sourceDir = path.resolve(process.argv[2] ?? '../template-source');
    const template = process.argv[3] ?? '';
    const customizationFile = process.argv[4]
        ? path.resolve(process.argv[4])
        : '';
    const operationalBindingsFile = process.argv[5]
        ? path.resolve(process.argv[5])
        : '';
    const errors = await validateTemplatePackage({
        sourceDir,
        template,
        customizationFile,
        operationalBindingsFile
    });
    if (errors.length > 0) {
        console.error('Template package validation failed:');
        errors.forEach((error) => {
            console.error(`- ${error}`);
        });
        process.exit(1);
    }
    const manifest = readTemplateManifest(
        path.join(sourceDir, 'templates', template, 'manifest.ts')
    );
    const version = manifest.manifestVersion ?? manifest.version;
    console.log(`Template package validation passed: ${template}@${version}`);
}

if (isCliEntry(import.meta.url)) {
    await runCli();
}
