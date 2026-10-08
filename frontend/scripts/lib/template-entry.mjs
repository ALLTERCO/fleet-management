// The filesystem half of entry resolution; the contract itself lives in
// src/shell/template-contract.ts.

import fs from 'node:fs';
import path from 'node:path';
import {
    DEFAULT_TEMPLATE_KIND,
    SUPPORTED_TEMPLATE_KINDS,
    templateKindContract
} from '../../src/shell/template-contract.ts';

// Any `<word>-spa` is a template-kind spelling, which separates "declares an
// unsupported kind" from "omits kind" and from a nested page's `kind`.
const TEMPLATE_KIND_SHAPE = /-spa$/;

function declaredValues(source, key) {
    const pattern = new RegExp(`\\b${key}\\s*:\\s*['"]([^'"]+)['"]`, 'g');
    return [...source.matchAll(pattern)].map((match) => match[1]);
}

export function readTemplateEntryDeclaration(manifestSource) {
    const kinds = declaredValues(manifestSource, 'kind');
    return {
        kind:
            kinds.find((value) => SUPPORTED_TEMPLATE_KINDS.includes(value)) ??
            kinds.find((value) => TEMPLATE_KIND_SHAPE.test(value)) ??
            '',
        renderer: declaredValues(manifestSource, 'renderer')[0] ?? '',
        entry: declaredValues(manifestSource, 'entry')[0] ?? ''
    };
}

function isInside(parent, child) {
    const relative = path.relative(parent, child);
    return (
        relative !== '' &&
        !relative.startsWith('..') &&
        !path.isAbsolute(relative)
    );
}

// A string-only check passes a symlink pointing anywhere on disk.
function realPathOrNull(target) {
    try {
        return fs.realpathSync(target);
    } catch {
        return null;
    }
}

function failure(reason) {
    return {ok: false, reason};
}

function resolveKind(declaration) {
    const kind = declaration.kind || DEFAULT_TEMPLATE_KIND;
    if (!SUPPORTED_TEMPLATE_KINDS.includes(kind)) {
        return failure(
            `kind must be one of ${SUPPORTED_TEMPLATE_KINDS.join(', ')}, got "${kind}"`
        );
    }
    const contract = templateKindContract(kind);
    if (declaration.renderer && declaration.renderer !== contract.renderer) {
        return failure(
            `kind "${kind}" requires renderer "${contract.renderer}", got "${declaration.renderer}"`
        );
    }
    return {ok: true, kind, ...contract};
}

export function resolveTemplateEntry(options) {
    const {sourceDir, templateDir} = options;
    const resolvedKind = resolveKind(options);
    if (!resolvedKind.ok) return resolvedKind;
    const {kind, renderer, entryFile} = resolvedKind;

    const entry = options.entry || entryFile;
    if (path.isAbsolute(entry)) {
        return failure(`entry must be a relative path, got "${entry}"`);
    }
    if (path.basename(entry) !== entryFile) {
        return failure(
            `kind "${kind}" requires the entry file "${entryFile}", got "${entry}"`
        );
    }

    const declared = [
        path.resolve(templateDir, entry),
        path.resolve(sourceDir, entry)
    ].find((candidate) => fs.existsSync(candidate));
    if (!declared) return failure(`entry not found: ${entry}`);
    if (!fs.statSync(declared).isFile()) {
        return failure(`entry is not a file: ${entry}`);
    }

    const realEntry = realPathOrNull(declared);
    const realTemplateDir = realPathOrNull(templateDir);
    if (!realEntry || !realTemplateDir) {
        return failure(`entry cannot be resolved: ${entry}`);
    }
    if (!isInside(realTemplateDir, realEntry)) {
        return failure(`entry escapes the template directory: ${entry}`);
    }
    // Docker stages the template directory flat, so an entry in a subdirectory
    // would resolve here and not in the build.
    if (path.dirname(realEntry) !== realTemplateDir) {
        return failure(`entry must sit at the template root, got "${entry}"`);
    }

    return {ok: true, kind, renderer, entryFile, entry, path: realEntry};
}
