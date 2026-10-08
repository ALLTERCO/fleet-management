import {createHash} from 'node:crypto';
import type {JsonSchema} from '../../types/api/_schema';
import {McpError} from './mcpErrors';
import {type CatalogEntry, readCatalog} from './mcpPolicy';

const PAGE_LIMIT = 100;

export interface MethodPage {
    items: CatalogEntry[];
    total: number;
    nextCursor: string | null;
    catalogVersion: string;
}

export const METHOD_PAGE_INPUT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        namespace: {type: 'string'},
        readOnly: {type: 'boolean'},
        cursor: {type: 'string'},
        limit: {type: 'integer', minimum: 1, maximum: PAGE_LIMIT}
    }
};

export const METHOD_PAGE_OUTPUT_SCHEMA = {
    type: 'object',
    required: ['items', 'total', 'nextCursor', 'catalogVersion'],
    properties: {
        items: {type: 'array', items: {type: 'object'}},
        total: {type: 'integer', minimum: 0},
        nextCursor: {type: ['string', 'null']},
        catalogVersion: {type: 'string'}
    }
};

function invalidCursor(): never {
    throw new McpError('invalid_params', 'Invalid or stale method cursor', {
        tool: 'list_methods'
    });
}

function cursorOffset(value: unknown, fingerprint: string): number {
    if (value === undefined) return 0;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        return invalidCursor();
    }
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== value) {
        return invalidCursor();
    }
    const [version, hash, offset, extra] = decoded.split(':');
    const number = Number(offset);
    if (
        version !== '1' ||
        hash !== fingerprint ||
        extra !== undefined ||
        !/^[1-9]\d*$/.test(offset ?? '') ||
        !Number.isSafeInteger(number)
    ) {
        return invalidCursor();
    }
    return number;
}

export function listMethods(
    input: Record<string, unknown> = {},
    catalog: readonly CatalogEntry[] = readCatalog().methods
): MethodPage {
    const {namespace, readOnly, limit = 25} = input;
    if (
        Object.keys(input).some(
            (key) => !['namespace', 'readOnly', 'limit', 'cursor'].includes(key)
        ) ||
        (namespace !== undefined && typeof namespace !== 'string') ||
        (readOnly !== undefined && typeof readOnly !== 'boolean') ||
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > PAGE_LIMIT
    ) {
        throw new McpError('invalid_params', 'Invalid method page parameters', {
            tool: 'list_methods'
        });
    }
    const filter =
        typeof namespace === 'string' ? namespace.trim().toLowerCase() : '';
    const all = [...catalog].sort((a, b) => a.id.localeCompare(b.id));
    const catalogVersion = createHash('sha256')
        .update(JSON.stringify(all))
        .digest('hex');
    const fingerprint = createHash('sha256')
        .update(JSON.stringify([catalogVersion, filter, readOnly ?? null]))
        .digest('hex');
    const matches = all.filter(
        (entry) =>
            (!filter || entry.namespace.toLowerCase() === filter) &&
            (readOnly === undefined || entry.safety.readOnlyHint === readOnly)
    );
    const offset = cursorOffset(input.cursor, fingerprint);
    if (offset > 0 && offset >= matches.length) return invalidCursor();
    const items = matches.slice(offset, offset + limit);
    const next = offset + items.length;
    return {
        items,
        total: matches.length,
        catalogVersion,
        nextCursor:
            next < matches.length
                ? Buffer.from(`1:${fingerprint}:${next}`).toString('base64url')
                : null
    };
}
