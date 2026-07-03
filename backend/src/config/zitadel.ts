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
