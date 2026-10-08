// Describes every installed node type from the same editor scripts the
// Node-RED editor loads, so Fleet Manager validates graphs against the
// installed definitions instead of a hand-written list.
//
// The scripts come only from this runtime's registry, never from a request.
// They already run in this process as installed packages; the vm context
// only keeps their globals apart and stops a script that never ends.

const {createHash} = require('node:crypto');
const vm = require('node:vm');

const DEFINITIONS_VERSION = 1;
const SCRIPT_TIMEOUT_MS = 1000;
const MAX_FAILURE_TEXT = 200;
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const TYPE_ATTRIBUTE = /\btype\s*=\s*["']([^"']*)["']/i;
const JAVASCRIPT_TYPES = new Set([
    '',
    'text/javascript',
    'application/javascript',
    'module'
]);
// Request headers that describe this hop, not the caller.
const HOP_HEADERS = new Set([
    'accept',
    'accept-encoding',
    'connection',
    'content-length',
    'content-type',
    'host',
    'keep-alive',
    'transfer-encoding',
    'upgrade'
]);
const RULE = Symbol('fleet-validator-rule');

function javascriptBlocks(html) {
    const blocks = [];
    for (const match of html.matchAll(SCRIPT_BLOCK)) {
        const type = (TYPE_ATTRIBUTE.exec(match[1])?.[1] || '').toLowerCase();
        if (JAVASCRIPT_TYPES.has(type) && !/\bsrc\s*=/i.test(match[1])) {
            blocks.push(match[2]);
        }
    }
    return blocks;
}

// Absorbs any editor-only call (jQuery, window, i18n) without effect.
function inert() {
    const target = () => proxy;
    const proxy = new Proxy(target, {
        get: (_target, key) => (key === Symbol.toPrimitive ? () => '' : proxy),
        apply: () => proxy,
        construct: () => proxy,
        has: () => true,
        set: () => true
    });
    return proxy;
}

function tagged(rule) {
    const validate = () => true;
    validate[RULE] = rule;
    return validate;
}

function typedInputRule(ptypeName, isConfig) {
    const options =
        typeof ptypeName === 'string'
            ? {typeField: ptypeName, isConfig, allowBlank: false}
            : ptypeName || {};
    return {
        kind: 'typedInput',
        ...(typeof options.type === 'string' ? {type: options.type} : {}),
        ...(typeof options.typeField === 'string'
            ? {typeField: options.typeField}
            : {}),
        allowBlank: options.allowBlank === true,
        allowUndefined: options.allowUndefined === true
    };
}

const VALIDATORS = Object.freeze({
    number: (blankAllowed) =>
        tagged({kind: 'number', blankAllowed: Boolean(blankAllowed)}),
    regex: (re) =>
        tagged(
            // A RegExp from the script's own realm fails instanceof here.
            typeof re === 'object' &&
                re !== null &&
                typeof re.source === 'string'
                ? {kind: 'regex', source: re.source, flags: re.flags || ''}
                : {kind: 'custom'}
        ),
    typedInput: (ptypeName, isConfig) =>
        tagged(typedInputRule(ptypeName, isConfig))
});

function editorSandbox(register) {
    const nodes = new Proxy(
        {registerType: register},
        {get: (target, key) => (key in target ? target[key] : inert())}
    );
    const RED = new Proxy(
        {nodes, validators: VALIDATORS, _: (key) => String(key)},
        {get: (target, key) => (key in target ? target[key] : inert())}
    );
    return {
        RED,
        $: inert(),
        jQuery: inert(),
        window: inert(),
        document: inert(),
        navigator: inert(),
        monaco: inert(),
        console: {log() {}, warn() {}, error() {}, info() {}, debug() {}}
    };
}

function jsonValue(value) {
    try {
        const text = JSON.stringify(value);
        return text === undefined ? undefined : JSON.parse(text);
    } catch {
        return undefined;
    }
}

function describeValidator(validate) {
    if (typeof validate !== 'function') return undefined;
    return validate[RULE] ? {...validate[RULE]} : {kind: 'custom'};
}

function describeProperty(property) {
    if (!property || typeof property !== 'object') return {};
    const value = jsonValue(property.value);
    const validator = describeValidator(property.validate);
    return {
        ...(value === undefined ? {} : {value}),
        ...(typeof property.required === 'boolean'
            ? {required: property.required}
            : {}),
        ...(typeof property.type === 'string'
            ? {configType: property.type}
            : {}),
        ...(validator ? {validator} : {})
    };
}

function describeDefinition(definition) {
    const defaults =
        definition && typeof definition.defaults === 'object'
            ? definition.defaults
            : {};
    return {
        category:
            typeof definition?.category === 'string'
                ? definition.category
                : null,
        outputs: Number.isSafeInteger(definition?.outputs)
            ? definition.outputs
            : null,
        defaults: Object.fromEntries(
            Object.entries(defaults).map(([name, property]) => [
                name,
                describeProperty(property)
            ])
        ),
        credentials: Object.keys(definition?.credentials || {})
    };
}

function failureText(error) {
    return String(error?.message || error)
        .replace(/\s+/g, ' ')
        .slice(0, MAX_FAILURE_TEXT);
}

function describeEditorDefinitions(html) {
    const types = {};
    const failures = [];
    const register = (type, definition) => {
        if (typeof type === 'string' && type) {
            types[type] = describeDefinition(definition);
        }
    };
    javascriptBlocks(html).forEach((script, index) => {
        try {
            vm.runInNewContext(script, editorSandbox(register), {
                timeout: SCRIPT_TIMEOUT_MS
            });
        } catch (error) {
            failures.push({script: index, reason: failureText(error)});
        }
    });
    return {version: DEFINITIONS_VERSION, types, failures};
}

function forwardedHeaders(req) {
    return Object.fromEntries(
        Object.entries(req.headers || {}).filter(
            ([name, value]) =>
                !HOP_HEADERS.has(name.toLowerCase()) &&
                typeof value === 'string'
        )
    );
}

function registryUrl(settings) {
    const root = String(settings.httpAdminRoot || '/').replace(/\/+$/, '');
    return `http://127.0.0.1:${settings.uiPort || 1880}${root}/nodes`;
}

// Reads the editor scripts through the documented admin API as the caller.
async function readEditorScripts(settings, req) {
    const res = await fetch(registryUrl(settings), {
        headers: {...forwardedHeaders(req), accept: 'text/html'}
    });
    if (!res.ok) throw new Error(`node registry returned ${res.status}`);
    return res.text();
}

function nodeDefinitionsHandler(RED) {
    let cached = {hash: '', result: null};
    return async (req, res) => {
        try {
            const html = await readEditorScripts(RED.settings, req);
            const hash = createHash('sha256').update(html).digest('hex');
            if (cached.hash !== hash) {
                cached = {hash, result: describeEditorDefinitions(html)};
            }
            res.json(cached.result);
        } catch (error) {
            res.status(502).json({error: failureText(error)});
        }
    };
}

module.exports = {
    DEFINITIONS_VERSION,
    describeEditorDefinitions,
    nodeDefinitionsHandler
};
