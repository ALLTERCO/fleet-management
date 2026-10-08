// Node property rules read from the installed Node-RED editor definitions.
// The Fleet Node-RED package describes them; this module applies the same
// checks as Node-RED's editor (validateNodeProperty and RED.validators) to
// graph records, and names the validators it cannot run.

import type {FlowRecord} from './flowClient';

export type NodeRedPropertyValidator =
    | {kind: 'number'; blankAllowed: boolean}
    | {kind: 'regex'; source: string; flags: string}
    | {
          kind: 'typedInput';
          type?: string;
          typeField?: string;
          allowBlank: boolean;
          allowUndefined: boolean;
      }
    | {kind: 'custom'};

export interface NodeRedPropertyDefinition {
    value?: unknown;
    required?: boolean;
    configType?: string;
    validator?: NodeRedPropertyValidator;
}

export interface NodeRedNodeDefinition {
    category: string | null;
    outputs: number | null;
    defaults: Record<string, NodeRedPropertyDefinition>;
    credentials: string[];
}

export interface NodeRedNodeDefinitions {
    version: 1;
    types: Record<string, NodeRedNodeDefinition>;
    failures: Array<{script: number; reason: string}>;
}

export interface DefinitionIssue {
    code: string;
    path: string;
    message: string;
}

export interface DefinitionCheckInput {
    record: FlowRecord;
    path: string;
    definition: NodeRedNodeDefinition;
    configsById: ReadonlyMap<string, FlowRecord>;
    registeredTypes: ReadonlySet<string>;
}

// RED.validators.number and RED.utils.validateTypedProperty accept these.
const NUMBER_PATTERN =
    /^NaN$|^[+-]?[0-9]*\.?[0-9]*([eE][-+]?[0-9]+)?$|^[+-]?(0b|0B)[01]+$|^[+-]?(0o|0O)[0-7]+$|^[+-]?(0x|0X)[0-9a-fA-F]+$/;
const ENV_REFERENCE =
    /^\$\([a-zA-Z_][a-zA-Z0-9_]*\)$|^\$\{[a-zA-Z_][a-zA-Z0-9_]*\}$/;
const TYPED_ENV_REFERENCE = /^\$\{[^}]+\}$/;
// Typed values Node-RED checks with code Fleet does not carry.
const UNCHECKED_TYPED_VALUES: ReadonlySet<string> = new Set([
    'msg',
    'flow',
    'global',
    'jsonata'
]);
// Bounds the work a package-supplied pattern can do on one value.
const MAX_PATTERN_INPUT = 4096;

type CheckResult = 'valid' | 'unchecked' | DefinitionIssue;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new TypeError(`invalid Node-RED node definitions: ${message}`);
}

function parseValidator(value: unknown): NodeRedPropertyValidator {
    if (!isRecord(value)) return {kind: 'custom'};
    if (value.kind === 'number') {
        return {kind: 'number', blankAllowed: value.blankAllowed === true};
    }
    if (value.kind === 'regex' && typeof value.source === 'string') {
        return {
            kind: 'regex',
            source: value.source,
            flags: typeof value.flags === 'string' ? value.flags : ''
        };
    }
    if (value.kind === 'typedInput') {
        return {
            kind: 'typedInput',
            ...(typeof value.type === 'string' ? {type: value.type} : {}),
            ...(typeof value.typeField === 'string'
                ? {typeField: value.typeField}
                : {}),
            allowBlank: value.allowBlank === true,
            allowUndefined: value.allowUndefined === true
        };
    }
    return {kind: 'custom'};
}

function parseProperty(value: unknown): NodeRedPropertyDefinition {
    if (!isRecord(value)) return {};
    return {
        ...(Object.hasOwn(value, 'value') ? {value: value.value} : {}),
        ...(typeof value.required === 'boolean'
            ? {required: value.required}
            : {}),
        ...(typeof value.configType === 'string'
            ? {configType: value.configType}
            : {}),
        ...(value.validator === undefined
            ? {}
            : {validator: parseValidator(value.validator)})
    };
}

function parseDefinition(type: string, value: unknown): NodeRedNodeDefinition {
    if (!isRecord(value) || !isRecord(value.defaults)) {
        invalid(`type ${type} has no defaults object`);
    }
    return {
        category: typeof value.category === 'string' ? value.category : null,
        outputs: Number.isSafeInteger(value.outputs)
            ? Number(value.outputs)
            : null,
        defaults: Object.fromEntries(
            Object.entries(value.defaults).map(([name, property]) => [
                name,
                parseProperty(property)
            ])
        ),
        credentials: Array.isArray(value.credentials)
            ? value.credentials.filter(
                  (name): name is string => typeof name === 'string'
              )
            : []
    };
}

/** Parse the Fleet package's node-definitions response. */
export function parseNodeRedNodeDefinitions(
    payload: unknown
): NodeRedNodeDefinitions {
    if (!isRecord(payload) || payload.version !== 1) {
        invalid('unsupported version');
    }
    if (!isRecord(payload.types)) invalid('types must be an object');
    return {
        version: 1,
        types: Object.fromEntries(
            Object.entries(payload.types).map(([type, definition]) => [
                type,
                parseDefinition(type, definition)
            ])
        ),
        failures: Array.isArray(payload.failures)
            ? payload.failures.filter(isRecord).map((failure) => ({
                  script: Number(failure.script),
                  reason: String(failure.reason ?? '')
              }))
            : []
    };
}

function issue(code: string, path: string, message: string): DefinitionIssue {
    return {code, path, message};
}

function isBlank(value: unknown): boolean {
    return value === '' || value === undefined || value === null;
}

function checkNumber(
    validator: {blankAllowed: boolean},
    value: unknown
): boolean {
    if (validator.blankAllowed && (value === '' || value === undefined)) {
        return true;
    }
    if (value !== '' && NUMBER_PATTERN.test(String(value))) return true;
    if (TYPED_ENV_REFERENCE.test(String(value))) return true;
    return typeof value !== 'symbol' && !Number.isNaN(Number(value));
}

function checkPattern(
    validator: {source: string; flags: string},
    value: unknown
): boolean | 'unchecked' {
    const text = String(value);
    if (text.length > MAX_PATTERN_INPUT) return 'unchecked';
    try {
        return new RegExp(validator.source, validator.flags).test(text);
    } catch {
        return 'unchecked';
    }
}

function typedValueType(
    validator: Extract<NodeRedPropertyValidator, {kind: 'typedInput'}>,
    record: FlowRecord
): unknown {
    return (
        validator.type ??
        (validator.typeField ? record[validator.typeField] : undefined)
    );
}

function checkTypedValue(
    validator: Extract<NodeRedPropertyValidator, {kind: 'typedInput'}>,
    value: unknown,
    record: FlowRecord
): CheckResult | string {
    if (validator.allowBlank && value === '') return 'valid';
    if (validator.allowUndefined && value === undefined) return 'valid';
    if (value && TYPED_ENV_REFERENCE.test(String(value))) return 'valid';
    const type = typedValueType(validator, record);
    if (typeof type === 'string' && UNCHECKED_TYPED_VALUES.has(type)) {
        return 'unchecked';
    }
    if (type === 'json') {
        try {
            JSON.parse(String(value));
            return 'valid';
        } catch {
            return 'json';
        }
    }
    if (type === 'num' && !NUMBER_PATTERN.test(String(value))) return 'num';
    return 'valid';
}

function checkValidator(
    validator: NodeRedPropertyValidator,
    value: unknown,
    input: {record: FlowRecord; path: string}
): CheckResult {
    if (validator.kind === 'number') {
        return checkNumber(validator, value)
            ? 'valid'
            : issue('property_number', input.path, 'must be a number');
    }
    if (validator.kind === 'regex') {
        const matched = checkPattern(validator, value);
        if (matched === 'unchecked') return 'unchecked';
        return matched
            ? 'valid'
            : issue(
                  'property_pattern',
                  input.path,
                  'does not match the installed node pattern'
              );
    }
    if (validator.kind === 'typedInput') {
        const result = checkTypedValue(validator, value, input.record);
        if (result === 'valid' || result === 'unchecked') return result;
        if (typeof result === 'string') {
            return issue(
                'property_typed_value',
                input.path,
                `must be a valid ${result} value`
            );
        }
        return result;
    }
    return 'unchecked';
}

// Mirrors the editor: an empty reference is valid only when required:false.
function checkConfigReference(
    property: NodeRedPropertyDefinition & {configType: string},
    value: unknown,
    input: DefinitionCheckInput & {propertyPath: string}
): DefinitionIssue | null {
    if (!value || value === '_ADD_') {
        return property.required === false
            ? null
            : issue(
                  'config_reference_missing',
                  input.propertyPath,
                  'is required'
              );
    }
    const target = input.configsById.get(String(value));
    if (!target) {
        return issue(
            'config_reference_missing',
            input.propertyPath,
            `references missing config ${String(value)}`
        );
    }
    return target.type === property.configType
        ? null
        : issue(
              'config_reference_type',
              input.propertyPath,
              'references the wrong config type'
          );
}

function checkProperty(
    name: string,
    property: NodeRedPropertyDefinition,
    input: DefinitionCheckInput
): DefinitionIssue | null {
    const value = Object.hasOwn(input.record, name)
        ? input.record[name]
        : property.value;
    const propertyPath = `${input.path}.${name}`;
    if (typeof value === 'string' && ENV_REFERENCE.test(value)) return null;
    if (
        property.configType &&
        !property.validator &&
        input.registeredTypes.has(property.configType)
    ) {
        return checkConfigReference(
            {...property, configType: property.configType},
            value,
            {...input, propertyPath}
        );
    }
    if (property.required === true && isBlank(value)) {
        return issue('property_required', propertyPath, 'is required');
    }
    if (!property.validator) return null;
    if (property.required === false && value === '') return null;
    const result = checkValidator(property.validator, value, {
        record: input.record,
        path: propertyPath
    });
    return typeof result === 'string' ? null : result;
}

/** Issues the installed editor definition would raise for one record. */
export function checkAgainstDefinition(
    input: DefinitionCheckInput
): DefinitionIssue[] {
    return Object.entries(input.definition.defaults).flatMap(
        ([name, property]) => checkProperty(name, property, input) ?? []
    );
}

/** Output count Node-RED uses: the node's own outputs, else the type's. */
export function definitionOutputs(
    record: FlowRecord,
    definition: NodeRedNodeDefinition
): number | undefined {
    if (Number.isSafeInteger(record.outputs) && Number(record.outputs) >= 0) {
        return Number(record.outputs);
    }
    return definition.outputs ?? undefined;
}

function validatorAlwaysChecked(validator: NodeRedPropertyValidator): boolean {
    if (validator.kind === 'custom') return false;
    if (validator.kind !== 'typedInput') return true;
    // A type chosen per node may be one Fleet cannot check.
    return (
        validator.type !== undefined &&
        !UNCHECKED_TYPED_VALUES.has(validator.type)
    );
}

/** Properties whose installed editor validator Fleet cannot always run. */
export function uncheckedDefinitionProperties(
    definition: NodeRedNodeDefinition
): string[] {
    return Object.entries(definition.defaults)
        .filter(
            ([, property]) =>
                property.validator !== undefined &&
                !validatorAlwaysChecked(property.validator)
        )
        .map(([name]) => name)
        .sort();
}
