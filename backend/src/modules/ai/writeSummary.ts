// Human-readable summaries for prepared writes plus a param check against
// the Describe schema, so a person approves a sentence, not raw JSON, and
// an invalid action never gets a token. One home per allowlisted method.

import {McpError} from './mcpErrors.js';

interface JsonSchema {
    required?: string[];
    properties?: Record<string, unknown>;
}

export interface WriteSummary {
    title: string;
    reversible: boolean;
    affected?: string;
}

function str(params: Record<string, unknown>, key: string): string {
    const v = params[key];
    return typeof v === 'string' ? v : String(v ?? '?');
}

// Per-method summary builders. Fall back to a generic sentence for any
// allowlisted method without a bespoke builder.
const BUILDERS: Record<string, (p: Record<string, unknown>) => WriteSummary> = {
    'group.create': (p) => ({
        title: `Create group "${str(p, 'name')}".`,
        reversible: true
    }),
    'group.update': (p) => ({
        title: `Update group ${str(p, 'id')}.`,
        reversible: true,
        affected: `group ${str(p, 'id')}`
    }),
    'group.delete': (p) => ({
        title: `Delete group ${str(p, 'id')}. This removes the group.`,
        reversible: false,
        affected: `group ${str(p, 'id')}`
    }),
    'tag.create': (p) => ({
        title: `Create tag "${str(p, 'name')}".`,
        reversible: true
    }),
    'tag.delete': (p) => ({
        title: `Delete tag ${str(p, 'id')}.`,
        reversible: false,
        affected: `tag ${str(p, 'id')}`
    }),
    'location.create': (p) => ({
        title: `Create location "${str(p, 'name')}".`,
        reversible: true
    }),
    'dashboard.create': (p) => ({
        title: `Create dashboard "${str(p, 'name')}".`,
        reversible: true
    }),
    'alert.rule.create': () => ({
        title: 'Create an alert rule. It may trigger notifications.',
        reversible: true
    })
};

export function buildWriteSummary(
    method: string,
    params: Record<string, unknown>
): WriteSummary {
    const build = BUILDERS[method.toLowerCase()];
    if (build) return build(params);
    const verb = method.split('.').pop() ?? method;
    return {
        title: `${verb} on ${method}.`,
        reversible: !/delete/i.test(method)
    };
}

// Reject before a token is issued when a required Describe param is absent.
export function assertParamsValid(
    method: string,
    params: Record<string, unknown>,
    schema: unknown
): void {
    const s = schema as JsonSchema | undefined;
    for (const key of s?.required ?? []) {
        if (params[key] === undefined) {
            throw new McpError(
                'invalid_params',
                `${method} requires "${key}"`,
                {tool: 'fm_write', method}
            );
        }
    }
}
