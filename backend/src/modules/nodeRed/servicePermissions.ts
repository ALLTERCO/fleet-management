// The one home of the Node-RED service account's default permissions. Deploy
// passes only an operator's own list; everything else lands here.

/** Reads the nodes' pickers, filters and examples need, device control, two narrow writes. */
export const NODE_RED_DEFAULT_PERMISSIONS: readonly string[] = Object.freeze([
    'device:read',
    'device:execute',
    'action:execute',
    'action:read',
    'action:update',
    'group:read',
    'location:read',
    'tag:read',
    'dashboard:read',
    'notification:update'
]);

// Older deploys saved their default into state and Zitadel metadata as if an
// operator had chosen it. Seeing one again means nobody chose it.
const RETIRED_DEFAULTS: readonly (readonly string[])[] = Object.freeze([
    Object.freeze(['device:read', 'device:execute', 'action:execute'])
]);

function sameSet(a: readonly string[], b: readonly string[]): boolean {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((p) => right.has(p));
}

/** True when the list is a default an older deploy wrote, not a choice. */
export function isRetiredNodeRedDefault(
    permissions: readonly string[]
): boolean {
    return RETIRED_DEFAULTS.some((retired) => sameSet(retired, permissions));
}

/** The list to grant: a retired default becomes today's default. */
export function upgradeRetiredNodeRedDefault(
    permissions: readonly string[]
): string[] {
    return isRetiredNodeRedDefault(permissions)
        ? [...NODE_RED_DEFAULT_PERMISSIONS]
        : [...permissions];
}
