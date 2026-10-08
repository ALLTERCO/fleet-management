/** Zitadel deployment identity — values that vary per environment and
 *  live in deploy/env/*.env. Single read path for the whole backend. */
import {envInt, envIntRequired, envStr} from './envReader';

export function zitadelProjectName(): string {
    return envStr('ZITADEL_PROJECT_NAME', 'fleet-manager');
}

export function zitadelClientProjectId(): string | undefined {
    const v = envStr('ZITADEL_CLIENT_PROJECT_ID', '').trim();
    return v.length > 0 ? v : undefined;
}

export function zitadelDefaultOrgId(): string | undefined {
    const v = envStr('ZITADEL_DEFAULT_ORG_ID', '').trim();
    return v.length > 0 ? v : undefined;
}

// Client org id this FM process is pinned to.
export function fmClientOrgId(): string | undefined {
    const v = envStr('FM_CLIENT_ORG_ID', '').trim();
    return v.length > 0 ? v : undefined;
}

// Shelly/provider support org id for hidden support authority.
export function fmPlatformOrgId(): string | undefined {
    const v = envStr('FM_PLATFORM_ORG_ID', '').trim();
    return v.length > 0 ? v : undefined;
}

// Display names for those orgs — the same names the deploy gives Zitadel.
export function fmClientOrgName(): string | undefined {
    const v = envStr('FM_CLIENT_ORG_NAME', '').trim();
    return v.length > 0 ? v : undefined;
}

export function fmPlatformOrgName(): string | undefined {
    const v = envStr('FM_PLATFORM_ORG_NAME', '').trim();
    return v.length > 0 ? v : undefined;
}

export function fmPlatformAdminRole(): string {
    return envStr('FM_PLATFORM_ADMIN_ROLE', 'IAM_OWNER').trim();
}

export function fmPlatformSupportReadRole(): string {
    return envStr('FM_PLATFORM_SUPPORT_READ_ROLE', 'IAM_OWNER_VIEWER').trim();
}

// Per-request timeout for Zitadel Management API calls.
export function zitadelHttpTimeoutMs(): number {
    return envInt('ZITADEL_HTTP_TIMEOUT_MS', 5000);
}

export function zitadelPatDefaultExpirationDays(): number {
    return envIntRequired('ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS');
}

// Max page size for v2 list endpoints (Zitadel server caps at 1000).
export function zitadelListPageSize(): number {
    return envIntRequired('ZITADEL_LIST_PAGE_SIZE');
}

/** MCP levels a browser login can reach; `full` stays key-only. */
const MCP_OAUTH_LEVELS = ['read', 'write'] as const;
export type McpOAuthLevel = (typeof MCP_OAUTH_LEVELS)[number];

const MCP_OAUTH_ENTRY = /^([a-z]+)=([^\s=,]+)$/;

/**
 * Zitadel MCP apps as client id -> level, from FM_MCP_OAUTH_CLIENT_IDS
 * ("read=<id>,write=<id>"). Empty means browser login is off. A malformed
 * value throws, so a bad deploy stops at boot instead of mapping tokens wrongly.
 */
export function mcpOAuthClientLevels(): ReadonlyMap<string, McpOAuthLevel> {
    const raw = envStr('FM_MCP_OAUTH_CLIENT_IDS', '');
    const byClient = new Map<string, McpOAuthLevel>();
    if (raw.length === 0) return byClient;
    for (const entry of raw.split(',')) {
        const {clientId, level} = parseMcpOAuthEntry(entry.trim());
        if (byClient.has(clientId) || [...byClient.values()].includes(level)) {
            throw new Error(
                `FM_MCP_OAUTH_CLIENT_IDS names a level or client twice: ${entry.trim()}`
            );
        }
        byClient.set(clientId, level);
    }
    return byClient;
}

function parseMcpOAuthEntry(entry: string): {
    clientId: string;
    level: McpOAuthLevel;
} {
    const match = MCP_OAUTH_ENTRY.exec(entry);
    const level = MCP_OAUTH_LEVELS.find((known) => known === match?.[1]);
    if (!match || !level) {
        throw new Error(
            `FM_MCP_OAUTH_CLIENT_IDS entry must be read=<id> or write=<id>, got: ${entry}`
        );
    }
    return {clientId: match[2], level};
}

/** Fleet's public base URL as clients reach it, without a trailing slash. */
export function fmPublicBaseUrl(): string | undefined {
    const v = envStr('FM_PUBLIC_BASE_URL', '').replace(/\/+$/, '');
    return v.length > 0 ? v : undefined;
}

// The issuer browsers and MCP clients see; the backend authority may be a
// Docker-internal address. Same precedence as the SPA runtime config.
export function zitadelPublicIssuerUrl(): string | undefined {
    const v = envStr('OIDC_ISSUER', '') || envStr('OIDC_AUTHORITY', '');
    return v.length > 0 ? v : undefined;
}

// The scopes the SPA asks Zitadel for, as the container entrypoint finalised
// them (organization pin included); unset outside the container.
export function oidcScopes(): string[] {
    return envStr('OIDC_SCOPE_EFFECTIVE', '')
        .split(/\s+/)
        .filter((scope) => scope.length > 0);
}
