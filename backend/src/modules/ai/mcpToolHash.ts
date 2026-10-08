// Fingerprints of the tool surface, so a client can pin the tools a person
// approved and notice when a description, schema or annotation changes
// afterwards (the "rug pull"). Deterministic: the same definitions always
// give the same values, whichever instance answers.

import {stableHash} from '../authz/stableJson.js';

export const TOOL_HASH_META = 'com.shelly.fleet/toolHash';
export const TOOL_SET_DIGEST_META = 'com.shelly.fleet/toolSetDigest';

const SHA256_HEX_LENGTH = 64;

interface ToolDefinition {
    name: string;
    _meta?: Record<string, unknown>;
}

function sha256(value: unknown): string {
    return `sha256:${stableHash(value, SHA256_HEX_LENGTH)}`;
}

/** Hash of everything a tool tells the model and the client, except _meta. */
export function toolHash(tool: ToolDefinition): string {
    const {_meta: _ignored, ...definition} = tool;
    return sha256(definition);
}

/** The tools, each stamped with its own hash in `_meta`. */
export function withToolHashes<T extends ToolDefinition>(tools: T[]): T[] {
    return tools.map((tool) => ({
        ...tool,
        _meta: {...tool._meta, [TOOL_HASH_META]: toolHash(tool)}
    }));
}

/** One value for the whole list in its order: changes when any tool does. */
export function toolSetDigest(tools: ToolDefinition[]): string {
    return sha256(tools.map((tool) => [tool.name, toolHash(tool)]));
}
