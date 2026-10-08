import {configRc} from '../../config';
import {envStr} from '../../config/envReader';
import {type McpOAuthLevel, mcpOAuthClientLevels} from '../../config/zitadel';

interface OidcAuthorizationConfig {
    clientId?: string;
    profile?: {clientId?: string};
}

export function assertFleetTokenBinding(
    claims: Record<string, unknown>,
    userinfo: Record<string, unknown> | null,
    fleetProjectId: string,
    options: {allowMissingProjectBinding?: boolean} = {}
): void {
    const projectRoleClaim = `urn:zitadel:iam:org:project:${fleetProjectId}:roles`;
    const projectValues = [
        ...stringValues(claims.aud),
        ...stringValues(userinfo?.aud),
        ...stringValues(claims['urn:zitadel:iam:org:project:id']),
        ...stringValues(userinfo?.['urn:zitadel:iam:org:project:id'])
    ];
    const hasProjectBinding =
        projectValues.includes(fleetProjectId) ||
        claims[projectRoleClaim] !== undefined ||
        userinfo?.[projectRoleClaim] !== undefined;
    if (!hasProjectBinding && !options.allowMissingProjectBinding) {
        throw new Error('JWT project mismatch');
    }

    const expectedAudiences = expectedOidcAudiences(fleetProjectId);
    const clientValues = [
        ...stringValues(claims.azp),
        ...stringValues(claims.client_id),
        ...stringValues(claims.aud),
        ...stringValues(userinfo?.azp),
        ...stringValues(userinfo?.client_id),
        ...stringValues(userinfo?.aud)
    ];
    // Fail-closed: a token with no aud/azp/client_id in either the
    // introspection claims or userinfo carries no audience proof. Without
    // it the project-binding bypass (allowMissingProjectBinding) would be
    // the only gate, which is not sufficient on its own.
    if (clientValues.length === 0) {
        throw new Error('JWT missing client identification');
    }
    if (!clientValues.some((value) => expectedAudiences.has(value))) {
        throw new Error('JWT client mismatch');
    }
}

export type TokenClient =
    | {kind: 'personal_token'}
    | {kind: 'session'}
    | {kind: 'mcp'; clientId: string; level: McpOAuthLevel}
    | {kind: 'refused'; reason: 'ambiguous_client' | 'unknown_client'};

/**
 * Which kind of credential an introspected Zitadel token is, by the client it
 * was issued to. Zitadel lists the project and every client of it in `aud`,
 * so only `client_id`/`azp` tell apps apart: a Fleet client is a session, an
 * MCP app an MCP credential, and any other app in the project is refused.
 * A personal access token names no client at all.
 */
export function classifyTokenClient(
    claims: Record<string, unknown>
): TokenClient {
    const named = new Set([
        ...stringValues(claims.client_id),
        ...stringValues(claims.azp)
    ]);
    if (named.size === 0) return {kind: 'personal_token'};
    const mcpClients = mcpOAuthClientLevels();
    if ([...named].some((clientId) => mcpClients.has(clientId))) {
        const [clientId] = named;
        const level = named.size === 1 ? mcpClients.get(clientId) : undefined;
        return level
            ? {kind: 'mcp', clientId, level}
            : {kind: 'refused', reason: 'ambiguous_client'};
    }
    const sessionClients = fleetSessionClients();
    return [...named].every((clientId) => sessionClients.has(clientId))
        ? {kind: 'session'}
        : {kind: 'refused', reason: 'unknown_client'};
}

// Fleet's own OIDC clients: the backend API app and the browser app (SPA).
function fleetSessionClients(): Set<string> {
    const authorization = configRc.oidc?.backend?.authorization as
        | OidcAuthorizationConfig
        | undefined;
    const frontend = configRc.oidc?.frontend as
        | Record<string, unknown>
        | undefined;
    const values = new Set<string>();
    addIfSet(values, authorization?.clientId);
    addIfSet(values, authorization?.profile?.clientId);
    addIfSet(values, frontend?.clientId);
    addIfSet(values, frontend?.client_id);
    addIfSet(values, envStr('OIDC_CLIENT_ID', ''));
    return values;
}

function expectedOidcAudiences(fleetProjectId: string): Set<string> {
    const values = fleetSessionClients();
    values.add(fleetProjectId);
    addIfSet(values, envStr('OIDC_PROJECT_ID', ''));
    return values;
}

function addIfSet(values: Set<string>, value: unknown): void {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length > 0) values.add(trimmed);
}

function stringValues(value: unknown): string[] {
    if (typeof value === 'string' && value.length > 0) return [value];
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
    }
    return [];
}
