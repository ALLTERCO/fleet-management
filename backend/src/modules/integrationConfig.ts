import {validateOrThrow} from '../rpc/validateOrThrow';
import {
    CHANNEL_PROVIDER_CONFIG_SCHEMAS,
    type ChannelProvider
} from '../types/api/channel';

type JsonRecord = Record<string, unknown>;
type HeaderSecret = {index: number; name: string; value: string};

const SECRET_PATHS: Record<ChannelProvider, string[]> = {
    email_smtp: [
        'auth.pass',
        'auth.clientSecret',
        'auth.refreshToken',
        'dkim.privateKey'
    ],
    generic_webhook: ['signingSecret'],
    slack_webhook: ['url'],
    teams_workflow_webhook: ['url'],
    telegram_bot: ['botToken'],
    push_fcm: ['token'],
    sms_twilio: [],
    voice_twilio: [],
    webhook_signed: ['signingSecret']
};

function isPlainObject(value: unknown): value is JsonRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneRecord(value: unknown): JsonRecord {
    if (!isPlainObject(value)) return {};
    return structuredClone(value);
}

function cloneArray(value: unknown): unknown[] {
    return Array.isArray(value) ? structuredClone(value) : [];
}

function withoutKey(source: JsonRecord, key: string): JsonRecord {
    const result: JsonRecord = {};
    for (const [entryKey, value] of Object.entries(source)) {
        if (entryKey !== key) result[entryKey] = value;
    }
    return result;
}

function getAtPath(source: JsonRecord, path: string): unknown {
    let current: unknown = source;
    for (const part of path.split('.')) {
        if (!isPlainObject(current) || !(part in current)) return undefined;
        current = current[part];
    }
    return current;
}

function setAtPath(target: JsonRecord, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: JsonRecord = target;
    for (const part of parts.slice(0, -1)) {
        const next = current[part];
        if (!isPlainObject(next)) {
            current[part] = {};
        }
        current = current[part] as JsonRecord;
    }
    current[parts.at(-1)!] = value;
}

function deleteAtPath(target: JsonRecord, path: string): void {
    const parts = path.split('.');
    const trail: JsonRecord[] = [target];
    let current: JsonRecord = target;

    for (const part of parts.slice(0, -1)) {
        const next = current[part];
        if (!isPlainObject(next)) return;
        current = next;
        trail.push(current);
    }

    delete current[parts.at(-1)!];

    for (let index = parts.length - 2; index >= 0; index--) {
        const parent = trail[index];
        const key = parts[index];
        const child = parent[key];
        if (isPlainObject(child) && Object.keys(child).length === 0) {
            delete parent[key];
            continue;
        }
        break;
    }
}

function deepMerge(base: JsonRecord, patch: JsonRecord): JsonRecord {
    const result = cloneRecord(base);
    for (const [key, value] of Object.entries(patch)) {
        if (isPlainObject(value) && isPlainObject(result[key])) {
            result[key] = deepMerge(result[key] as JsonRecord, value);
            continue;
        }
        result[key] = structuredClone(value);
    }
    return result;
}

function readHeaderSecrets(secretConfig: JsonRecord): HeaderSecret[] {
    return cloneArray(secretConfig.headerSecrets).filter(
        (item): item is HeaderSecret =>
            isPlainObject(item) &&
            Number.isInteger(item.index) &&
            typeof item.name === 'string' &&
            typeof item.value === 'string'
    );
}

function splitGenericWebhookHeaders(
    publicConfig: JsonRecord,
    secretConfig: JsonRecord
): void {
    const headers = cloneArray(publicConfig.headers);
    const headerSecrets: HeaderSecret[] = [];
    const publicHeaders = headers.map((raw, index) => {
        if (!isPlainObject(raw)) return raw;
        const header = cloneRecord(raw);
        if (
            header.secret === true &&
            typeof header.name === 'string' &&
            typeof header.value === 'string'
        ) {
            headerSecrets.push({
                index,
                name: header.name,
                value: header.value
            });
            return withoutKey(header, 'value');
        }
        return header;
    });
    if (headers.length > 0) publicConfig.headers = publicHeaders;
    if (headerSecrets.length > 0) secretConfig.headerSecrets = headerSecrets;
}

function mergeGenericWebhookHeaders(
    publicConfig: JsonRecord,
    secretConfig: JsonRecord
): JsonRecord {
    const merged = withoutKey(
        deepMerge(publicConfig, secretConfig),
        'headerSecrets'
    );

    const headers = cloneArray(publicConfig.headers);
    const secrets = readHeaderSecrets(secretConfig);
    if (headers.length === 0 || secrets.length === 0) return merged;

    const byName = new Map<string, HeaderSecret>();
    for (const secret of secrets) {
        if (!byName.has(secret.name)) byName.set(secret.name, secret);
    }

    merged.headers = headers.map((raw, index) => {
        if (!isPlainObject(raw)) return raw;
        const header = cloneRecord(raw);
        if (header.secret !== true || typeof header.name !== 'string') {
            return header;
        }
        const indexed = secrets.find(
            (secret) => secret.index === index && secret.name === header.name
        );
        const named = byName.get(header.name);
        const secret = indexed ?? named;
        if (secret) header.value = secret.value;
        return header;
    });
    return merged;
}

function restoreGenericWebhookHeaderSecrets(
    fullConfig: JsonRecord,
    currentSecretConfig: unknown
): JsonRecord {
    const headers = cloneArray(fullConfig.headers);
    const secrets = readHeaderSecrets(cloneRecord(currentSecretConfig));
    if (headers.length === 0 || secrets.length === 0) return fullConfig;

    const restored = cloneRecord(fullConfig);
    const byName = new Map<string, HeaderSecret>();
    for (const secret of secrets) {
        if (!byName.has(secret.name)) byName.set(secret.name, secret);
    }

    restored.headers = headers.map((raw, index) => {
        if (!isPlainObject(raw)) return raw;
        const header = cloneRecord(raw);
        if (
            header.secret !== true ||
            header.value !== undefined ||
            typeof header.name !== 'string'
        ) {
            return header;
        }
        const indexed = secrets.find(
            (secret) => secret.index === index && secret.name === header.name
        );
        const secret = indexed ?? byName.get(header.name);
        if (secret) header.value = secret.value;
        return header;
    });
    return restored;
}

// API read-path marker for secret fields (Datadog / OWASP convention).
export const SECRET_FIELD_REDACTION_MARKER = '[REDACTED]';

// Read-path masking: fills the marker into secret-flagged headers that
// were stripped at write-time. Adapter path is unaffected (uses merge).
export function redactSecretHeadersForResponse(
    provider: ChannelProvider,
    publicConfig: unknown
): JsonRecord {
    const clone = cloneRecord(publicConfig);
    if (provider !== 'generic_webhook') return clone;
    const headers = cloneArray(clone.headers);
    if (headers.length === 0) return clone;
    clone.headers = headers.map((raw) => {
        if (!isPlainObject(raw)) return raw;
        const header = cloneRecord(raw);
        if (header.secret === true && header.value === undefined) {
            header.value = SECRET_FIELD_REDACTION_MARKER;
        }
        return header;
    });
    return clone;
}

export function splitIntegrationConfig(
    provider: ChannelProvider,
    config: unknown
): {
    publicConfig: JsonRecord;
    secretConfig: JsonRecord;
    hasSecretFields: boolean;
} {
    const publicConfig = cloneRecord(config);
    const secretConfig: JsonRecord = {};

    for (const path of SECRET_PATHS[provider]) {
        const value = getAtPath(publicConfig, path);
        if (value === undefined) continue;
        setAtPath(secretConfig, path, value);
        deleteAtPath(publicConfig, path);
    }
    if (provider === 'generic_webhook') {
        splitGenericWebhookHeaders(publicConfig, secretConfig);
    }

    return {
        publicConfig,
        secretConfig,
        hasSecretFields: Object.keys(secretConfig).length > 0
    };
}

export function mergeIntegrationConfig(
    provider: ChannelProvider,
    publicConfig: unknown,
    secretConfig: unknown
): JsonRecord;
export function mergeIntegrationConfig(
    publicConfig: unknown,
    secretConfig: unknown
): JsonRecord;
export function mergeIntegrationConfig(
    providerOrPublicConfig: ChannelProvider | unknown,
    publicOrSecretConfig?: unknown,
    secretConfigInput?: unknown
): JsonRecord {
    if (
        typeof providerOrPublicConfig === 'string' &&
        providerOrPublicConfig in SECRET_PATHS
    ) {
        const provider = providerOrPublicConfig as ChannelProvider;
        const publicConfig = cloneRecord(publicOrSecretConfig);
        const secretConfig = cloneRecord(secretConfigInput);
        if (provider === 'generic_webhook') {
            return mergeGenericWebhookHeaders(publicConfig, secretConfig);
        }
        return deepMerge(publicConfig, secretConfig);
    }
    return deepMerge(
        cloneRecord(providerOrPublicConfig),
        cloneRecord(publicOrSecretConfig)
    );
}

export function mergeIntegrationConfigPatch(
    provider: ChannelProvider,
    currentPublicConfig: unknown,
    currentSecretConfig: unknown,
    patchConfig: unknown
): {
    publicConfig: JsonRecord;
    secretConfig: JsonRecord;
    fullConfig: JsonRecord;
    hasSecretFields: boolean;
} {
    const currentFullConfig = mergeIntegrationConfig(
        provider,
        currentPublicConfig,
        currentSecretConfig
    );
    let fullConfig = deepMerge(currentFullConfig, cloneRecord(patchConfig));
    if (provider === 'generic_webhook') {
        fullConfig = restoreGenericWebhookHeaderSecrets(
            fullConfig,
            currentSecretConfig
        );
    }

    validateOrThrow(fullConfig, CHANNEL_PROVIDER_CONFIG_SCHEMAS[provider]);
    const split = splitIntegrationConfig(provider, fullConfig);

    return {
        ...split,
        fullConfig
    };
}

export function validateIntegrationConfig(
    provider: ChannelProvider,
    config: unknown
): {
    publicConfig: JsonRecord;
    secretConfig: JsonRecord;
    fullConfig: JsonRecord;
    hasSecretFields: boolean;
} {
    const fullConfig = cloneRecord(config);
    validateOrThrow(fullConfig, CHANNEL_PROVIDER_CONFIG_SCHEMAS[provider]);
    const split = splitIntegrationConfig(provider, fullConfig);
    return {
        ...split,
        fullConfig
    };
}
