// JSON Schema Draft-7 subset shared by backend (validators) and frontend
// (form binding). Pure types + literals — zero runtime helpers other than the
// trivial deep-clone used by Describe to freeze schemas before publication.
// Lives inside api/ so the contract layer is closed under imports.

export type JsonSchemaType =
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'array'
    | 'object'
    | 'null';

export interface JsonSchema {
    type?: JsonSchemaType | JsonSchemaType[];
    required?: string[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    enum?: readonly unknown[];
    const?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    /** Semantic format hint (uuid, date-time). Runtime-enforced per Draft-7. */
    format?: 'uuid' | 'date-time' | string;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
    minProperties?: number;
    maxProperties?: number;
    /** Max JSON-serialized byte size (applies to objects / arrays). */
    maxBytes?: number;
    additionalProperties?: boolean | JsonSchema;
    /** Value must satisfy at least one of the listed schemas. */
    anyOf?: JsonSchema[];
    /** Value must satisfy exactly one of the listed schemas. */
    oneOf?: JsonSchema[];
    /** Value must satisfy every listed schema. */
    allOf?: JsonSchema[];
    default?: unknown;
    /** Human-readable label for this field. */
    title?: string;
    /** Free-form description shown to external clients. */
    description?: string;
    /** Semantic unit tag: "power", "temperature", "currency", … */
    unit?: string;
    /** Additional schema keys are tolerated and ignored at runtime. */
    [extra: string]: unknown;
}

// Common time-range maxima used by API schemas.
export const MAX_RANGE = {
    DAY: 24 * 60 * 60 * 1000,
    WEEK: 7 * 24 * 60 * 60 * 1000,
    MONTH: 30 * 24 * 60 * 60 * 1000,
    QUARTER: 90 * 24 * 60 * 60 * 1000,
    YEAR: 365 * 24 * 60 * 60 * 1000
} as const;

// Largest value an INT4 column / ::INTEGER cast holds. A field whose value
// lands in an INT4 column must cap here so an oversized value is rejected at
// the boundary instead of overflowing the cast at write/read.
export const INT4_MAX = 2_147_483_647;

// Non-negative integer bounded to INT4 — counts, durations, display orders
// that are stored in an INTEGER column.
export const NON_NEGATIVE_INT4_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 0,
    maximum: INT4_MAX
};

// Deep-clone — Describe freezes schemas before publication.
export function describeSchema(schema: JsonSchema): JsonSchema {
    return JSON.parse(JSON.stringify(schema)) as JsonSchema;
}
