import Ajv2020 from 'ajv/dist/2020.js';
import type {JsonSchema} from '../../src/types/api/_schema';

const validator = new Ajv2020({strict: false, validateFormats: false});
const MAX_DEPTH = 16;
const MAX_ITEMS = 100;
const MAX_STRING_LENGTH = 10_000;

// A finite vocabulary keeps examples deterministic without inventing a regex generator.
const STRING_EXAMPLES = [
    'string',
    '1970-01-01',
    '01-01',
    '00:00',
    'EUR',
    'BG',
    '00:11:22:33:44:55',
    '00',
    '0'.repeat(64),
    '00000000-0000-4000-8000-000000000000',
    'https://example.com',
    'user@example.com',
    'vdev_example',
    'switch:0'
];
const FORMAT_EXAMPLES: Record<string, string> = {
    'date-time': '1970-01-01T00:00:00.000Z',
    date: '1970-01-01',
    uuid: '00000000-0000-4000-8000-000000000000'
};

export function exampleValue(schema: JsonSchema, depth = 0): unknown {
    if (depth > MAX_DEPTH) throw new Error('API example exceeds nesting limit');
    const validate = validator.compile(schema);
    for (const candidate of candidates(schema, depth)) {
        if (validate(candidate)) return structuredClone(candidate);
    }
    throw new Error(
        `Cannot generate a valid API example; provide schema.examples: ${JSON.stringify(schema)}`
    );
}

// This is only a sampling view; Ajv always checks candidates against the original schema.
function samplingView(schemas: JsonSchema[]): JsonSchema {
    const view: JsonSchema = {};
    for (const schema of schemas) {
        Object.assign(view, schema);
    }
    view.required = [
        ...new Set(schemas.flatMap((schema) => schema.required ?? []))
    ];
    view.properties = {};
    for (const schema of schemas) {
        for (const [key, value] of Object.entries(schema.properties ?? {})) {
            const previous = view.properties[key];
            view.properties[key] = previous
                ? {allOf: [previous, value]}
                : value;
        }
    }
    for (const key of [
        'minimum',
        'exclusiveMinimum',
        'minLength',
        'minItems',
        'minProperties'
    ] as const) {
        const values = schemas
            .map((schema) => schema[key])
            .filter((value): value is number => typeof value === 'number');
        if (values.length) view[key] = Math.max(...values);
    }
    for (const key of [
        'maximum',
        'exclusiveMaximum',
        'maxLength',
        'maxItems',
        'maxProperties'
    ] as const) {
        const values = schemas
            .map((schema) => schema[key])
            .filter((value): value is number => typeof value === 'number');
        if (values.length) view[key] = Math.min(...values);
    }
    return view;
}

function* candidates(schema: JsonSchema, depth: number): Generator<unknown> {
    if (depth > MAX_DEPTH) throw new Error('API example exceeds nesting limit');
    for (const value of [
        schema.const,
        ...(schema.examples ?? []),
        schema.default,
        ...(schema.enum ?? [])
    ]) {
        if (value !== undefined) yield value;
    }
    if (schema.allOf?.length) {
        const {allOf, ...siblings} = schema;
        yield* candidates(samplingView([siblings, ...allOf]), depth + 1);
        return;
    }
    const alternatives = schema.oneOf ?? schema.anyOf;
    if (alternatives?.length) {
        const {oneOf: _oneOf, anyOf: _anyOf, ...siblings} = schema;
        for (const branch of alternatives) {
            yield* candidates(samplingView([siblings, branch]), depth + 1);
        }
        return;
    }
    if (schema.const !== undefined || schema.enum) return;
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const type of types) {
        if (type === 'string') yield* stringCandidates(schema);
        else if (type === 'integer' || type === 'number')
            yield* numberCandidates(schema);
        else if (type === 'boolean') {
            yield false;
            yield true;
        } else if (type === 'null') yield null;
        else if (type === 'array') {
            const count = Math.max(
                schema.minItems ?? 0,
                schema.maxItems === 0 ? 0 : schema.items ? 1 : 0
            );
            if (count > MAX_ITEMS)
                throw new Error(
                    'API example exceeds array limit; provide schema.examples'
                );
            yield Array.from({length: count}, () =>
                exampleValue(schema.items ?? {}, depth + 1)
            );
        } else if (type === 'object' || schema.properties || schema.required) {
            yield objectExample(schema, depth);
        } else {
            yield null;
            yield {};
        }
    }
}

function* stringCandidates(schema: JsonSchema): Generator<string> {
    if (schema.format && FORMAT_EXAMPLES[schema.format])
        yield FORMAT_EXAMPLES[schema.format];
    const length = Math.max(
        schema.minLength ?? 0,
        Math.min(6, schema.maxLength ?? 6)
    );
    if (length > MAX_STRING_LENGTH)
        throw new Error(
            'API example exceeds string limit; provide schema.examples'
        );
    for (const value of STRING_EXAMPLES) {
        if (schema.format && FORMAT_EXAMPLES[schema.format]) break;
        yield value.length < length ? value.padEnd(length, 'x') : value;
        yield value;
    }
    if (!schema.format) yield 'x'.repeat(length);
}

function* numberCandidates(schema: JsonSchema): Generator<number> {
    const lower =
        typeof schema.exclusiveMinimum === 'number'
            ? schema.exclusiveMinimum
            : schema.minimum;
    const upper =
        typeof schema.exclusiveMaximum === 'number'
            ? schema.exclusiveMaximum
            : schema.maximum;
    yield schema.minimum ?? 0;
    if (lower !== undefined) yield Math.floor(lower) + 1;
    if (upper !== undefined) yield Math.ceil(upper) - 1;
    if (lower !== undefined && upper !== undefined)
        yield lower + (upper - lower) / 2;
    if (upper !== undefined) yield upper;
}

function objectExample(
    schema: JsonSchema,
    depth: number
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
        result[key] = exampleValue(properties[key] ?? {}, depth + 1);
    }
    for (const [key, property] of Object.entries(properties)) {
        if (Object.keys(result).length >= (schema.minProperties ?? 0)) break;
        if (!(key in result)) result[key] = exampleValue(property, depth + 1);
    }
    return result;
}
