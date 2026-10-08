#!/usr/bin/env node

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import ts from 'typescript';
import {isCliEntry} from '../../frontend/scripts/lib/cli-entry.mjs';
import {
    operationalBindingDeclarationIssues,
    readTemplateManifest,
    useTypeScript
} from '../../frontend/scripts/lib/template-manifest.mjs';
import {findUnsafeCustomizationIssues} from '../../frontend/src/shell/customization-safety.ts';

// This package's own typescript; the shared parser has none of its own.
useTypeScript(ts);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '../..');
const schemaPath = path.join(
    repositoryRoot,
    'deploy/schema/bm-deploy-request-v1.schema.json'
);
const operationalBindingsSchemaPath = path.join(
    repositoryRoot,
    'deploy/schema/operational-bindings-v1.schema.json'
);

function sha256(raw) {
    return createHash('sha256').update(raw).digest('hex');
}

function normalizeDigest(value = '') {
    return value.toLowerCase().replace(/^sha256:/, '');
}

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function customizationBindingIssues(customization) {
    const errors = [];
    function visit(value, location) {
        if (Array.isArray(value)) {
            value.forEach((entry, index) =>
                visit(entry, `${location}[${index}]`)
            );
            return;
        }
        if (!isRecord(value)) return;
        for (const [key, child] of Object.entries(value)) {
            if (
                key === 'operationalBindings' ||
                key === 'tariffId' ||
                key === 'exportTariffId'
            ) {
                errors.push(
                    `${location}.${key} is deployment-owned and not customizable`
                );
            }
            visit(child, `${location}.${key}`);
        }
    }
    visit(customization, 'customization');
    return errors;
}

export function readOperationalBindingDeclarations(manifest = {}) {
    return Array.isArray(manifest.operationalBindings)
        ? manifest.operationalBindings
        : [];
}

function requestHasOperationalBindings(request) {
    const bindings = request?.operationalBindings;
    return isRecord(bindings) && Object.keys(bindings).length > 0;
}

function declaredBindingIssues(request, manifest) {
    if (!manifest) return [];
    if (!isRecord(manifest)) {
        return ['selected template manifest must export an object'];
    }
    const errors = [];
    const manifestId = manifest.id;
    if (manifestId && manifestId !== request?.template?.id) {
        errors.push(
            `selected template manifest id "${manifestId}" does not match request template "${request?.template?.id ?? '<missing>'}"`
        );
    }
    errors.push(
        ...operationalBindingDeclarationIssues(
            request?.operationalBindings ?? {},
            manifest
        )
    );
    return errors;
}

const TEMPLATE_REQUIREMENT_KEYS = [
    'requiredHostExports',
    'requiredFleetDomains',
    'requiredFleetCapabilities'
];

function pinnedTemplateRequirementIssues(request, manifest) {
    const errors = [];
    for (const key of TEMPLATE_REQUIREMENT_KEYS) {
        const declared = manifest?.[key];
        const received = request?.template?.[key];
        if (!Array.isArray(declared)) {
            errors.push(`selected template manifest must declare ${key}`);
            continue;
        }
        if (!Array.isArray(received)) {
            errors.push(`request template must include ${key}`);
            continue;
        }
        const expected = [...declared].sort();
        const actual = [...received].sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            errors.push(
                `request template ${key} does not match the selected template manifest`
            );
        }
    }
    return errors;
}

const FORBIDDEN_KEYS = new Set([
    'password',
    'secret',
    'apikey',
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'privatekey',
    'cardnumber',
    'cvc',
    'cvv',
    'credential',
    'credentials'
]);

function inspect(value, location = '$') {
    const errors = [];
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            errors.push(...inspect(item, `${location}[${index}]`));
        });
        return errors;
    }
    if (!isRecord(value)) return errors;
    for (const [key, child] of Object.entries(value)) {
        const normalized = key.replaceAll(/[_-]/g, '').toLowerCase();
        if (FORBIDDEN_KEYS.has(normalized)) {
            errors.push(`${location}.${key} is a forbidden secret/card field`);
        }
        errors.push(...inspect(child, `${location}.${key}`));
    }
    return errors;
}

function ajvFor(schema) {
    const ajv = new Ajv2020({allErrors: true, strict: true});
    ajv.addKeyword({keyword: 'x-binding-type'});
    ajv.addSchema(readJson(operationalBindingsSchemaPath));
    ajv.addFormat('date-time', {
        type: 'string',
        validate: (value) =>
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
            Number.isFinite(Date.parse(value))
    });
    ajv.addFormat('email', {
        type: 'string',
        validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    });
    ajv.addFormat('uri', {
        type: 'string',
        validate: (value) => {
            try {
                const url = new URL(value);
                return url.protocol === 'http:' || url.protocol === 'https:';
            } catch {
                return false;
            }
        }
    });
    return ajv.compile(schema);
}

export function validateBmDeployRequest({
    raw,
    schema,
    expected = {},
    templateManifest = null
}) {
    const digest = sha256(raw);
    const errors = [];
    let request;
    try {
        request = JSON.parse(raw.toString('utf8'));
    } catch (error) {
        return {
            ok: false,
            digest,
            errors: [`request is not JSON: ${error.message}`]
        };
    }

    const validate = ajvFor(schema);
    if (!validate(request)) {
        for (const error of validate.errors ?? []) {
            errors.push(
                `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`
            );
        }
    }
    errors.push(...inspect(request));
    errors.push(...findUnsafeCustomizationIssues(request?.customization));
    errors.push(...customizationBindingIssues(request?.customization));
    errors.push(...declaredBindingIssues(request, templateManifest));
    if (expected.requirePins && templateManifest) {
        errors.push(
            ...pinnedTemplateRequirementIssues(request, templateManifest)
        );
    }
    if (
        expected.requirePins &&
        requestHasOperationalBindings(request) &&
        !templateManifest
    ) {
        errors.push(
            'selected template manifest is required to validate operational bindings in pinned deployment mode'
        );
    }

    const expectedDigest = normalizeDigest(expected.sha256);
    if (expected.requirePins) {
        const required = [
            ['BM_REQUEST_EXPECTED_SHA256', expectedDigest],
            ['BM_EXPECTED_CLIENT_ID', expected.clientId],
            ['BM_EXPECTED_DOMAIN', expected.domain],
            ['BM_EXPECTED_TEMPLATE_COMMIT', expected.templateCommit],
            ['BM_EXPECTED_HOST_COMMIT', expected.hostCommit]
        ];
        for (const [name, value] of required) {
            if (!value) {
                errors.push(`${name} is required in pinned deployment mode`);
            }
        }
    }
    if (expectedDigest && expectedDigest !== digest) {
        errors.push(
            `SHA-256 mismatch: expected ${expectedDigest}, got ${digest}`
        );
    }
    if (expected.clientId && request?.client?.id !== expected.clientId) {
        errors.push(
            `client id does not match job scope: ${request?.client?.id ?? '<missing>'}`
        );
    }
    if (expected.domain && request?.client?.domain !== expected.domain) {
        errors.push(
            `domain does not match job scope: ${request?.client?.domain ?? '<missing>'}`
        );
    }
    if (
        expected.templateCommit &&
        request?.template?.sourceCommit !== expected.templateCommit
    ) {
        errors.push('template commit does not match the pinned job commit');
    }
    if (
        expected.hostCommit &&
        request?.template?.hostCommit !== expected.hostCommit
    ) {
        errors.push('Fleet host commit does not match the pinned job commit');
    }
    if (request?.client?.request) {
        const created = Date.parse(request.client.request.createdAt);
        const approved = Date.parse(request.client.request.approvedAt);
        if (
            Number.isFinite(created) &&
            Number.isFinite(approved) &&
            approved < created
        ) {
            errors.push('approvedAt must not precede createdAt');
        }
    }
    if (
        request?.customization?.schemaVersion !== undefined &&
        request.customization.schemaVersion !==
            request?.template?.overridesSchemaVersion
    ) {
        errors.push(
            'customization schemaVersion does not match template overridesSchemaVersion'
        );
    }
    return {ok: errors.length === 0, digest, errors, request};
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function runCli() {
    const args = process.argv.slice(2);
    const requirePins =
        args.includes('--require-pins') ||
        process.env.BM_REQUIRE_PINNED_REQUEST === 'true';
    const requestArgument = args.find((argument) => !argument.startsWith('--'));
    const manifestArgument = args.find((argument) =>
        argument.startsWith('--template-manifest=')
    );
    const requestPath = path.resolve(
        requestArgument ??
            path.join(
                repositoryRoot,
                'deploy/schema/examples/bm-deploy-request.smart-office.json'
            )
    );
    const raw = fs.readFileSync(requestPath);
    const templateManifest = manifestArgument
        ? readTemplateManifest(
              path.resolve(
                  manifestArgument.slice('--template-manifest='.length)
              )
          )
        : null;
    const result = validateBmDeployRequest({
        raw,
        schema: readJson(schemaPath),
        templateManifest,
        expected: {
            sha256: process.env.BM_REQUEST_EXPECTED_SHA256 ?? '',
            clientId: process.env.BM_EXPECTED_CLIENT_ID ?? '',
            domain: process.env.BM_EXPECTED_DOMAIN ?? '',
            templateCommit: process.env.BM_EXPECTED_TEMPLATE_COMMIT ?? '',
            hostCommit: process.env.BM_EXPECTED_HOST_COMMIT ?? '',
            requirePins
        }
    });
    if (!result.ok) {
        console.error(`BM deploy request validation failed: ${requestPath}`);
        result.errors.forEach((error) => {
            console.error(`- ${error}`);
        });
        process.exit(1);
    }
    console.log(
        `BM deploy request validation passed: ${requestPath} sha256:${result.digest}`
    );
}

if (isCliEntry(import.meta.url)) {
    runCli().catch((error) => {
        console.error(`BM deploy request validation failed: ${error.message}`);
        process.exit(1);
    });
}
