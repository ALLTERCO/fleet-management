// Runtime validators for the JSON Schema subset. Types + describeSchema live
// in the contract layer (`types/api/_schema.ts`); this file is backend-only.

import {
    describeSchema,
    type JsonSchema,
    type JsonSchemaType,
    MAX_RANGE
} from '../types/api/_schema';
import {makeDomainError, type RpcErrorPayload} from './errors';

// Re-export so existing callers (`from '../rpc/validation'`) keep working.
export {describeSchema, type JsonSchema, type JsonSchemaType, MAX_RANGE};

/**
 * Stable machine codes for validation failures — UI can switch on these
 * without parsing the human-readable `error` text.
 */
export type ValidationCode =
    | 'type'
    | 'const'
    | 'enum'
    | 'min'
    | 'max'
    | 'min_length'
    | 'max_length'
    | 'pattern'
    | 'min_items'
    | 'max_items'
    | 'min_properties'
    | 'max_properties'
    | 'max_bytes'
    | 'required'
    | 'additional_property'
    | 'any_of'
    | 'one_of'
    | 'all_of'
    | 'format'
    | 'date_invalid'
    | 'range_invalid';

export interface ValidationFailure {
    field: string;
    error: string;
    code: ValidationCode;
}

/**
 * Transport-agnostic validation error. The HTTP/WS transports convert
 * this to `RpcError.InvalidParams` at the boundary; pure library code
 * stays decoupled from `RpcError` so it can be reused without pulling
 * in config / plugin initialization.
 */
export class ValidationError extends Error {
    readonly payload: RpcErrorPayload;
    readonly failures: readonly ValidationFailure[];

    constructor(failures: readonly ValidationFailure[]) {
        const first = failures[0];
        super(
            first
                ? `validation failed at ${first.field}: ${first.error}`
                : 'validation failed'
        );
        this.name = 'ValidationError';
        this.failures = failures;
        this.payload = makeDomainError('ValidationFailed', {
            field: first?.field,
            details: failures
        });
    }
}

function typeOfValue(value: unknown): JsonSchemaType {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    const t = typeof value;
    if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    if (t === 'string' || t === 'boolean' || t === 'object') return t;
    return 'null';
}

function typeMatches(
    expected: JsonSchemaType | JsonSchemaType[],
    actual: JsonSchemaType
): boolean {
    const list = Array.isArray(expected) ? expected : [expected];
    if (list.includes(actual)) return true;
    // number schema accepts integers
    if (list.includes('number') && actual === 'integer') return true;
    return false;
}

// Canonical UUID per RFC 4122 §3 (any version 1–5).
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_DATE_TIME_RE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// JSON Schema `format` keywords FM publishes. Returns an error string on
// mismatch (so caller pushes a 'format' failure) or null when valid.
// Unknown formats are intentionally ignored — per Draft-7 §7.2.1 they are
// advisory; we only enforce the ones we publish.
function checkFormat(value: string, format: string): string | null {
    switch (format) {
        case 'uuid':
            return UUID_RE.test(value)
                ? null
                : 'must be a canonical UUID (RFC 4122)';
        case 'date-time': {
            if (!RFC3339_DATE_TIME_RE.test(value)) {
                return 'must be an RFC 3339 date-time';
            }
            const ms = Date.parse(value);
            if (Number.isNaN(ms)) return 'must be an ISO 8601 date-time';
            return null;
        }
        default:
            return null;
    }
}

/** Walk the schema and the value in parallel, collecting failures */
function walk(
    value: unknown,
    schema: JsonSchema,
    path: string,
    failures: ValidationFailure[]
): void {
    // type
    if (schema.type !== undefined) {
        const actual = typeOfValue(value);
        if (!typeMatches(schema.type, actual)) {
            failures.push({
                field: path || '(root)',
                error: `expected ${Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type}, got ${actual}`,
                code: 'type'
            });
            return;
        }
    }

    // const
    if (schema.const !== undefined && value !== schema.const) {
        failures.push({
            field: path || '(root)',
            error: `must equal ${JSON.stringify(schema.const)}`,
            code: 'const'
        });
    }

    // enum
    if (schema.enum && !schema.enum.includes(value as never)) {
        failures.push({
            field: path || '(root)',
            error: `must be one of ${JSON.stringify(schema.enum)}`,
            code: 'enum'
        });
    }

    // number bounds
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            failures.push({
                field: path || '(root)',
                error: `must be >= ${schema.minimum}`,
                code: 'min'
            });
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            failures.push({
                field: path || '(root)',
                error: `must be <= ${schema.maximum}`,
                code: 'max'
            });
        }
    }

    // string length + pattern + format
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            failures.push({
                field: path || '(root)',
                error: `must have at least ${schema.minLength} characters`,
                code: 'min_length'
            });
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            failures.push({
                field: path || '(root)',
                error: `must have at most ${schema.maxLength} characters`,
                code: 'max_length'
            });
        }
        if (typeof schema.pattern === 'string') {
            const re = new RegExp(schema.pattern);
            if (!re.test(value)) {
                failures.push({
                    field: path || '(root)',
                    error: `must match pattern ${schema.pattern}`,
                    code: 'pattern'
                });
            }
        }
        if (typeof schema.format === 'string') {
            const formatError = checkFormat(value, schema.format);
            if (formatError) {
                failures.push({
                    field: path || '(root)',
                    error: formatError,
                    code: 'format'
                });
            }
        }
    }

    // array
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) {
            failures.push({
                field: path || '(root)',
                error: `must have at least ${schema.minItems} items`,
                code: 'min_items'
            });
        }
        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
            failures.push({
                field: path || '(root)',
                error: `must have at most ${schema.maxItems} items`,
                code: 'max_items'
            });
        }
        if (schema.maxBytes !== undefined) {
            const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
            if (bytes > schema.maxBytes) {
                failures.push({
                    field: path || '(root)',
                    error: `must be at most ${schema.maxBytes} bytes when serialized (got ${bytes})`,
                    code: 'max_bytes'
                });
            }
        }
        if (schema.items) {
            for (let i = 0; i < value.length; i++) {
                walk(
                    value[i],
                    schema.items,
                    path ? `${path}[${i}]` : `[${i}]`,
                    failures
                );
            }
        }
    }

    // object — required, properties, size bounds, additionalProperties
    const isPlainObject =
        value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isPlainObject) {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);

        if (
            schema.minProperties !== undefined &&
            keys.length < schema.minProperties
        ) {
            failures.push({
                field: path || '(root)',
                error: `must have at least ${schema.minProperties} properties (minProperties)`,
                code: 'min_properties'
            });
        }
        if (
            schema.maxProperties !== undefined &&
            keys.length > schema.maxProperties
        ) {
            failures.push({
                field: path || '(root)',
                error: `must have at most ${schema.maxProperties} properties (maxProperties)`,
                code: 'max_properties'
            });
        }
        if (schema.maxBytes !== undefined) {
            const bytes = Buffer.byteLength(JSON.stringify(obj), 'utf8');
            if (bytes > schema.maxBytes) {
                failures.push({
                    field: path || '(root)',
                    error: `must be at most ${schema.maxBytes} bytes when serialized (got ${bytes})`,
                    code: 'max_bytes'
                });
            }
        }

        if (schema.required) {
            for (const key of schema.required) {
                if (!(key in obj) || obj[key] === undefined) {
                    failures.push({
                        field: path ? `${path}.${key}` : key,
                        error: 'required',
                        code: 'required'
                    });
                }
            }
        }
        const declared = schema.properties
            ? new Set(Object.keys(schema.properties))
            : new Set<string>();
        const additional = schema.additionalProperties;

        // additionalProperties:
        //   false          → reject undeclared keys
        //   JsonSchema obj → validate each undeclared key's value against it
        //   true/undefined → allow, no validation
        if (additional === false) {
            for (const key of keys) {
                if (!declared.has(key)) {
                    failures.push({
                        field: path ? `${path}.${key}` : key,
                        error: 'unexpected property (additionalProperties is false)',
                        code: 'additional_property'
                    });
                }
            }
        } else if (typeof additional === 'object' && additional !== null) {
            for (const key of keys) {
                if (!declared.has(key)) {
                    walk(
                        obj[key],
                        additional,
                        path ? `${path}.${key}` : key,
                        failures
                    );
                }
            }
        }
        if (schema.properties) {
            for (const [key, subSchema] of Object.entries(schema.properties)) {
                if (key in obj && obj[key] !== undefined) {
                    walk(
                        obj[key],
                        subSchema,
                        path ? `${path}.${key}` : key,
                        failures
                    );
                }
            }
        }
    }

    // anyOf — passes if value satisfies at least one alternative.
    if (schema.anyOf && schema.anyOf.length > 0) {
        const branchErrors: string[] = [];
        const pass = schema.anyOf.some((alt) => {
            const inner: ValidationFailure[] = [];
            walk(value, alt, path, inner);
            if (inner.length === 0) return true;
            branchErrors.push(inner.map((e) => e.error).join('; '));
            return false;
        });
        if (!pass) {
            failures.push({
                field: path || '(root)',
                error: `must match at least one of: ${branchErrors.join(' | ')}`,
                code: 'any_of'
            });
        }
    }

    // oneOf — passes if value satisfies exactly one alternative
    // (JSON Schema Draft-7 §6.7.3).
    if (schema.oneOf && schema.oneOf.length > 0) {
        let matches = 0;
        const branchErrors: string[] = [];
        for (const alt of schema.oneOf) {
            const inner: ValidationFailure[] = [];
            walk(value, alt, path, inner);
            if (inner.length === 0) matches++;
            else branchErrors.push(inner.map((e) => e.error).join('; '));
        }
        if (matches !== 1) {
            failures.push({
                field: path || '(root)',
                error:
                    matches === 0
                        ? `must match exactly one of: ${branchErrors.join(' | ')}`
                        : `matched ${matches} alternatives; oneOf requires exactly one`,
                code: 'one_of'
            });
        }
    }

    // allOf — value must satisfy every listed schema (Draft-7 §6.7.1).
    if (schema.allOf && schema.allOf.length > 0) {
        for (const alt of schema.allOf) {
            walk(value, alt, path, failures);
        }
    }
}

/** Mutate the value, filling in schema defaults for missing fields */
export function applyDefaults<T>(value: unknown, schema: JsonSchema): T {
    if (Array.isArray(value) && schema.items) {
        for (let i = 0; i < value.length; i++) {
            value[i] = applyDefaults(value[i], schema.items);
        }
        return value as T;
    }
    if (
        schema.type === 'object' &&
        schema.properties &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    ) {
        const obj = value as Record<string, unknown>;
        for (const [key, subSchema] of Object.entries(schema.properties)) {
            if (!(key in obj) && subSchema.default !== undefined) {
                // deep-clone the default so mutations don't leak back to the schema
                obj[key] = structuredClone(subSchema.default);
            }
            if (key in obj) {
                obj[key] = applyDefaults(obj[key], subSchema);
            }
        }
    }
    return value as T;
}

/**
 * Validate `params` against `schema`. On failure, throw a JSON-RPC
 * `InvalidParams` error whose `data` field carries the field-level list.
 *
 * Applies schema defaults before validation, and returns the (possibly
 * defaulted) value typed as `T`.
 */
export function validateParams<T>(params: unknown, schema: JsonSchema): T {
    const withDefaults = applyDefaults<T>(params ?? {}, schema);
    const failures: ValidationFailure[] = [];
    walk(withDefaults, schema, '', failures);
    if (failures.length > 0) {
        throw new ValidationError(failures);
    }
    return withDefaults;
}

// --- Date range helper ---------------------------------------------------

/**
 * Parse and validate a `[from, to]` ISO-8601 date range. Throws
 * `InvalidParams` if either bound is malformed, reversed, or the span
 * exceeds `maxMs`.
 */
export function parseDateRange(
    from: string,
    to: string,
    maxMs: number
): {from: Date; to: Date} {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime())) {
        throw new ValidationError([
            {field: 'from', error: 'not a valid date', code: 'date_invalid'}
        ]);
    }
    if (Number.isNaN(toDate.getTime())) {
        throw new ValidationError([
            {field: 'to', error: 'not a valid date', code: 'date_invalid'}
        ]);
    }
    if (fromDate.getTime() >= toDate.getTime()) {
        throw new ValidationError([
            {
                field: 'from',
                error: 'must be earlier than `to`',
                code: 'range_invalid'
            }
        ]);
    }
    if (toDate.getTime() - fromDate.getTime() > maxMs) {
        throw new ValidationError([
            {
                field: 'from..to',
                error: `span exceeds maximum of ${maxMs}ms`,
                code: 'range_invalid'
            }
        ]);
    }
    return {from: fromDate, to: toDate};
}
