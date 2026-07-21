// `Describe()` contract for v2 public components — types + builder.
// Lives in the contract layer (api/) with no upward deps so the frontend
// type graph never reaches into backend internals.

import {describeSchema, type JsonSchema} from './_schema';
import {describeErrors} from './errors';
import type {MeasurementMeta} from './measurement';
import type {SemanticType} from './semantic';

export type CrudOp = 'create' | 'read' | 'update' | 'delete' | 'execute';

// 'device'        — Shelly firmware methods relayed to the device.
// 'fleet-manager' — methods served by the FM server itself.
export type NamespaceKind = 'device' | 'fleet-manager';

export interface NamespaceMeta {
    kind: NamespaceKind;
    /** One-line imperative purpose of the namespace. */
    description: string;
}

export interface PermissionRequirement {
    component?: string;
    operation?: CrudOp;
    /** Free-form label for methods using custom checks. */
    note?: string;
}

// What the method DOES, when the permission alone can't say (note-only
// permissions). Optional overrides refine the operation-derived hints.
export interface MethodSafety {
    operation?: CrudOp;
    idempotent?: boolean;
    destructive?: boolean;
    /** Dispatcher/tunnel: the real effect depends on caller input. */
    effectDependsOnInput?: boolean;
}

export interface MethodDescriptor {
    name: string;
    params: JsonSchema;
    response: JsonSchema;
    permission: PermissionRequirement;
    description?: string;
    safety?: MethodSafety;
}

// One telemetry field a component emits. Field name is firmware-defined;
// measurement reuses FM's IEC 61850 model so the API says what each value is.
export interface MetricDescriptor {
    name: string;
    type: 'number' | 'integer' | 'boolean' | 'string';
    measurement: MeasurementMeta;
    /** What the value IS, picked from the shared semantic vocabulary; drives
     *  display formatting. Absent when no semantic type cleanly applies. */
    semantic?: SemanticType;
    /** Not every device of this component type emits the field. */
    optional?: boolean;
}

export interface DescribeOutput {
    /** Component namespace — mirrors the RPC prefix, e.g. "entity". */
    namespace: string;
    /** Whether the namespace is device-relayed or FM-served. */
    kind?: NamespaceKind;
    /** One-line purpose of this namespace, for humans and AI agents. */
    description?: string;
    methods: Record<string, MethodDescriptor>;
    limits?: Record<string, number>;
    tags?: readonly string[];
    /** Telemetry fields this component emits, each tagged with its measurement. */
    metrics?: readonly MetricDescriptor[];
    /** Domain errors this component may emit. */
    errors?: ReturnType<typeof describeErrors>;
}

// Builder accumulates method descriptors then renders an immutable Describe.
export class DescribeBuilder {
    readonly #namespace: string;
    readonly #methods = new Map<string, MethodDescriptor>();
    #limits?: Record<string, number>;
    #tags?: readonly string[];
    #metrics?: readonly MetricDescriptor[];
    #built?: DescribeOutput;

    readonly #kind?: NamespaceKind;
    readonly #description?: string;

    // meta is optional during the migration; kind + description become required
    // once every namespace declares them (enforced by the describe-shape gate).
    constructor(namespace: string, meta?: NamespaceMeta) {
        this.#namespace = namespace;
        this.#kind = meta?.kind;
        this.#description = meta?.description;
    }

    registerMethod(
        name: string,
        descriptor: Omit<MethodDescriptor, 'name'>
    ): this {
        if (this.#built) {
            throw new Error(
                `DescribeBuilder(${this.#namespace}): cannot register ${name} after build()`
            );
        }
        if (this.#methods.has(name)) {
            throw new Error(
                `DescribeBuilder(${this.#namespace}): duplicate method ${name}`
            );
        }
        this.#methods.set(name, {name, ...descriptor});
        return this;
    }

    setLimits(limits: Record<string, number>): this {
        this.#limits = {...limits};
        return this;
    }

    setTags(tags: readonly string[]): this {
        this.#tags = Object.freeze([...tags]);
        return this;
    }

    setMetrics(metrics: readonly MetricDescriptor[]): this {
        this.#metrics = Object.freeze([...metrics]);
        return this;
    }

    build(): DescribeOutput {
        if (this.#built) return this.#built;
        const methods: Record<string, MethodDescriptor> = {};
        for (const [name, descriptor] of this.#methods) {
            methods[name] = {
                name,
                params: describeSchema(descriptor.params),
                response: describeSchema(descriptor.response),
                permission: {...descriptor.permission},
                ...(descriptor.description !== undefined
                    ? {description: descriptor.description}
                    : {}),
                ...(descriptor.safety !== undefined
                    ? {safety: {...descriptor.safety}}
                    : {})
            };
        }
        // Self-describe: every namespace advertises Describe so clients
        // don't need out-of-band knowledge that it exists.
        if (!methods.Describe) {
            methods.Describe = {
                name: 'Describe',
                params: {type: 'object', properties: {}},
                response: {
                    type: 'object',
                    required: ['namespace', 'methods'],
                    properties: {
                        namespace: {type: 'string'},
                        methods: {type: 'object'},
                        limits: {type: 'object'},
                        tags: {type: 'array', items: {type: 'string'}},
                        errors: {type: 'array'}
                    }
                },
                permission: {note: 'public — no-permission metadata'},
                description: `Return the ${this.#namespace} namespace contract (methods, schemas, permissions, errors).`
            };
        }
        this.#built = Object.freeze({
            namespace: this.#namespace,
            ...(this.#kind ? {kind: this.#kind} : {}),
            ...(this.#description ? {description: this.#description} : {}),
            methods,
            ...(this.#limits ? {limits: {...this.#limits}} : {}),
            ...(this.#tags ? {tags: this.#tags} : {}),
            ...(this.#metrics ? {metrics: this.#metrics} : {}),
            errors: describeErrors()
        });
        return this.#built;
    }
}
