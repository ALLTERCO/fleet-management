/**
 * Which slice of the product an agent is working in.
 *
 * The capability level already answers "how much power does this key have" —
 * read, write, full. It says nothing about WHERE. An energy analyst and an
 * installer might both hold `write`, and neither has any business in the
 * other's surface.
 *
 *     allowed = level ∩ RBAC ∩ role
 *
 * A role only ever narrows. It cannot reach anything the level and the user's
 * own permissions did not already allow, so it is never an escalation — only a
 * smaller blast radius, and a shorter list of methods for the model to pick
 * from.
 *
 * THE NAMES ARE NOT NEW. They are the persona keys this product already uses
 * for humans. Inventing "energy_analyst" beside the existing `installer` and
 * `auditor` would give the product two role vocabularies that drift apart on
 * the first permission change. Where no persona describes the job, the answer
 * is a boundary-scoped key — which already exists — not a second vocabulary.
 *
 * What is NOT derived from the persona system is the slice itself. Personas
 * speak 17 resource types; the RPC surface is 133 namespaces, and no persona
 * row mentions firmware, tariff, zigbee or modbus — which is most of an
 * installer's actual day. So the names are shared and the mapping is its own
 * thing, stated here.
 *
 * There is deliberately no tool to change role mid-session. GitHub shipped
 * exactly that, ran it for about a year and removed it. And an agent that can
 * widen its own reach halfway through leaves an incident log where "what could
 * this thing touch when it opened that breaker" has a time-varying answer.
 */

import {
    AUTHZ_SYSTEM_PERSONA_KEYS,
    MCP_ROLE_KEYS,
    type McpRoleKey
} from '../../types/api/authzCatalog';

/**
 * The persona keys that describe a distinct MCP work slice. Declared on the
 * contract surface so the key-minting UI offers exactly what this enforces.
 */
export const MCP_ROLES = MCP_ROLE_KEYS;

export type McpRole = McpRoleKey;

/**
 * A role named on a key that is not a persona. Kept distinct from "no role" so
 * a typo cannot quietly become full access: an invalid role reaches nothing.
 */
export type McpRoleSelection = McpRole | 'invalid' | null;

/**
 * Namespaces every role needs to orient itself. Without these a role cannot
 * look up what it is working on, and the agent spends its budget on refusals
 * rather than work.
 */
const SHARED = [
    'device',
    'group',
    'location',
    'tag',
    'kind',
    'entity',
    'fleet',
    'fleetmap',
    'fleetsummary'
];

/**
 * What each role works on. Additive to SHARED; never a grant, only a filter.
 * A namespace missing from every role is still reachable by a key with no
 * role at all, which is every key that exists today.
 */
const ROLE_NAMESPACES: Record<McpRole, readonly string[]> = {
    // Puts hardware in and gets it talking.
    installer: [
        'addon',
        'ble',
        'bluassist',
        'blugw',
        'bthome',
        'cloud',
        'discovery',
        'eth',
        'firmware',
        'http',
        'matter',
        'mdns',
        'modbus',
        'mqtt',
        'ota',
        'shelly',
        'sys',
        'virtualdevice',
        'waitingroom',
        'wifi',
        'zigbee',
        'knx',
        'dali',
        'serial'
    ],
    // Runs the site day to day: what is on, what is wrong, what to do.
    operator: [
        'alert',
        'notification',
        'switch',
        'light',
        'cover',
        'thermostat',
        'trv',
        'fan',
        'camera',
        'presence',
        'presencezone',
        'sensor',
        'temperature',
        'humidity',
        'flood',
        'smoke',
        'illuminance',
        'dashboard',
        'analytics'
    ],
    // Money and reporting.
    manager: [
        'energy',
        'em',
        'em1',
        'emdata',
        'em1data',
        'devicepower',
        'tariff',
        'bill',
        'report',
        'reporttemplate',
        'analytics',
        'dashboard',
        'sensor'
    ],
    // Builds the things that act on their own.
    automation_admin: [
        'automation',
        'scopedautomation',
        'alert',
        'notification',
        'notification_policy',
        'schedule',
        'script',
        'webhook',
        'channel',
        'job',
        'kvs',
        'variables',
        'object',
        'message_text'
    ],
    // Reads the record. Deliberately no device or energy control surface.
    auditor: ['audit', 'authz_audit', 'permission', 'persona', 'policy', 'user']
};

/** Where a namespace belongs, for turning a refusal into a routing hint. */
export function roleOwningNamespace(namespace: string): McpRole | null {
    const wanted = namespace.trim().toLowerCase();
    for (const role of MCP_ROLES) {
        if (ROLE_NAMESPACES[role].includes(wanted)) return role;
    }
    return null;
}

/** Reads `mcp.role:<persona>` off a scoped key's audience. */
export function mcpRoleFromAudience(
    audience: string[] | undefined
): McpRoleSelection {
    if (!Array.isArray(audience)) return null;
    for (const raw of audience) {
        const value = String(raw).trim().toLowerCase();
        if (!value.startsWith('mcp.role:')) continue;
        const name = value.slice('mcp.role:'.length);
        const known = (MCP_ROLES as readonly string[]).includes(name);
        // A key that names a role we do not know must not fall through to
        // "no role", which would turn a typo into the full surface.
        return known ? (name as McpRole) : 'invalid';
    }
    return null;
}

/** May this role touch this namespace? No role means no restriction. */
export function mcpRoleAllowsNamespace(
    role: McpRoleSelection,
    namespace: string
): boolean {
    if (role === null) return true;
    if (role === 'invalid') return false;
    const wanted = namespace.trim().toLowerCase();
    return SHARED.includes(wanted) || ROLE_NAMESPACES[role].includes(wanted);
}

/** The namespaces a role can reach, published so an agent need not probe. */
export function namespacesForRole(role: McpRoleSelection): string[] | null {
    if (role === null) return null;
    if (role === 'invalid') return [];
    return [...new Set([...SHARED, ...ROLE_NAMESPACES[role]])].sort();
}

/** Guards the claim in MCP_ROLES that every name is a real persona key. */
export function rolesArePersonas(): boolean {
    return MCP_ROLES.every((role) =>
        (AUTHZ_SYSTEM_PERSONA_KEYS as readonly string[]).includes(role)
    );
}
